import { cache } from "react";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { avatarUrl } from "@/lib/dto/profile";
import { checkAvatar } from "@/lib/profile/avatar";
import { rateLimitKey, rateLimiter } from "@/lib/rate-limit";

/**
 * A person's own profile: what they are called, what they look like, and
 * their password. Every function takes the id of the signed-in user and acts
 * on that account only — there is no "edit someone else" path here.
 */

/** Guessing the current password from a stolen session is still guessing. */
const PASSWORD_ATTEMPT_RULE = { limit: 5, windowSeconds: 15 * 60 };

export function findProfile(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      bio: true,
      avatarUpdatedAt: true,
      createdAt: true,
    },
  });
}

/**
 * The signed-in person's own picture URL, for the header. Cached per request,
 * since the header renders on every signed-in page.
 */
export const getOwnAvatarUrl = cache(async (userId: string): Promise<string | null> => {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { avatarUpdatedAt: true },
  });
  return avatarUrl(userId, row?.avatarUpdatedAt);
});

export type ProfileRecord = NonNullable<Awaited<ReturnType<typeof findProfile>>>;

export async function updateProfile(
  userId: string,
  input: { name: string; bio: string },
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { name: input.name.trim(), bio: input.bio.trim() || null },
  });
}

export type SetAvatarResult =
  { ok: true } | { ok: false; reason: "empty" | "too_large" | "not_an_image" };

export async function setAvatar(userId: string, bytes: Uint8Array): Promise<SetAvatarResult> {
  const check = checkAvatar(bytes);
  if (!check.ok) return check;

  await db.user.update({
    where: { id: userId },
    data: {
      // Copied into a fresh buffer: Prisma wants an ArrayBuffer-backed array,
      // and what arrives from a form upload may be a view onto a larger one.
      avatar: new Uint8Array(bytes),
      avatarMime: check.mime,
      avatarUpdatedAt: new Date(),
    },
  });
  return { ok: true };
}

export async function removeAvatar(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { avatar: null, avatarMime: null, avatarUpdatedAt: null },
  });
}

/** The picture itself, for the access-checked route that serves it. */
export async function findAvatar(userId: string) {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { avatar: true, avatarMime: true },
  });
  if (!row?.avatar || !row.avatarMime) return null;
  return { bytes: row.avatar, mime: row.avatarMime };
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrong_password" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Changes the password, given the current one.
 *
 * Every other session is revoked — the usual reason to change a password is
 * the suspicion that someone else has it — but the session making the change
 * is kept, so the person is not thrown out of the page they are on.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string,
): Promise<ChangePasswordResult> {
  const key = rateLimitKey("password-change", userId);
  const limit = await rateLimiter.consume(key, PASSWORD_ATTEMPT_RULE);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, role: true },
  });
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, reason: "wrong_password" };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId, id: { not: keepSessionId } } }),
    db.activityLog.create({
      data: {
        action: "auth.password_changed",
        entityType: "User",
        entityId: userId,
        actorId: userId,
        actorRole: user.role,
      },
    }),
  ]);
  await rateLimiter.reset(key);

  return { ok: true };
}
