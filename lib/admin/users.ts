import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { Prisma, Role, UserStatus } from "@/lib/generated/prisma/client";

/**
 * People, for administrators: who has an account, and switching one off.
 *
 * Accounts are suspended, never deleted — their submissions, reviews and
 * audit entries are facts that must keep their owner. Every function trusts
 * that its caller has been through `requireRole("ADMIN")`.
 */

export type UserFilter = { role?: Role; status?: UserStatus; query?: string };

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  _count: { select: { submissions: true } },
  // What a reviewer currently has on their plate.
  assignmentsToReview: {
    where: { status: { in: ["PENDING", "ACCEPTED"] } },
    select: { id: true },
  },
  sessions: { orderBy: { lastUsedAt: "desc" }, take: 1, select: { lastUsedAt: true } },
} satisfies Prisma.UserSelect;

export type AdminUserRecord = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export function findUsers(filter: UserFilter = {}): Promise<AdminUserRecord[]> {
  const query = filter.query?.trim();
  return db.user.findMany({
    where: {
      role: filter.role,
      status: filter.status,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query.toLowerCase() } },
            ],
          }
        : {}),
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    take: 200,
    select: USER_SELECT,
  });
}

export type SuspendFailure = "not_found" | "is_you" | "last_admin" | "not_active";

/**
 * Suspends an account: it can no longer sign in, and every session it has is
 * ended at once.
 *
 * Two things are refused because they could lock everyone out: suspending
 * yourself, and suspending the only administrator who can still sign in.
 */
export async function suspendUser(
  admin: SessionUser,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: SuspendFailure }> {
  if (userId === admin.id) return { ok: false, reason: "is_you" };

  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
    if (!target) return { ok: false, reason: "not_found" } as const;
    if (target.status !== "ACTIVE") return { ok: false, reason: "not_active" } as const;

    if (target.role === "ADMIN") {
      const others = await tx.user.count({
        where: { role: "ADMIN", status: "ACTIVE", id: { not: target.id } },
      });
      if (others === 0) return { ok: false, reason: "last_admin" } as const;
    }

    await tx.user.update({ where: { id: target.id }, data: { status: "SUSPENDED" } });
    await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.activityLog.create({
      data: {
        action: "user.suspended",
        entityType: "User",
        entityId: target.id,
        actorId: admin.id,
        actorRole: admin.role,
      },
    });
    return { ok: true } as const;
  });
}

/** Lets a suspended account sign in again. */
export async function reactivateUser(admin: SessionUser, userId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, status: "SUSPENDED" },
      data: { status: "ACTIVE" },
    });
    if (count !== 1) return false;

    await tx.activityLog.create({
      data: {
        action: "user.reactivated",
        entityType: "User",
        entityId: userId,
        actorId: admin.id,
        actorRole: admin.role,
      },
    });
    return true;
  });
}

/** Headline numbers for the administrator's home page. */
export async function findPlatformCounts() {
  const [reviewers, submitters] = await Promise.all([
    db.user.count({ where: { role: "REVIEWER", status: "ACTIVE" } }),
    db.user.count({ where: { role: "USER", status: "ACTIVE" } }),
  ]);
  return { reviewers, submitters };
}
