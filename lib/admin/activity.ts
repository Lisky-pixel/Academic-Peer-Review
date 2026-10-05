import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * The activity log, for administrators. Append-only: nothing here writes,
 * edits or deletes an entry.
 */

export const ACTIVITY_PAGE_SIZE = 50;

/** Groups of actions, by the prefix of their name. */
export const ACTIVITY_CATEGORIES = {
  submission: { label: "Submissions and reviews", prefix: "submission." },
  auth: { label: "Sign-ins and accounts", prefix: "auth." },
  user: { label: "People", prefix: "user." },
  setup: { label: "Document types and templates", prefixes: ["document_type.", "template."] },
} as const;

export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;

export type ActivityFilter = {
  category?: ActivityCategory;
  /** Inclusive, as dates: "from the start of this day" to "the end of that day". */
  from?: Date;
  to?: Date;
  page?: number;
};

/** Midnight UTC at the start of the day `date` falls in. */
function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function where(filter: ActivityFilter): Prisma.ActivityLogWhereInput {
  const category = filter.category ? ACTIVITY_CATEGORIES[filter.category] : undefined;
  const prefixes = category
    ? "prefixes" in category
      ? [...category.prefixes]
      : [category.prefix]
    : undefined;

  return {
    ...(prefixes ? { OR: prefixes.map((prefix) => ({ action: { startsWith: prefix } })) } : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            gte: filter.from ? startOfDay(filter.from) : undefined,
            // "To the 14th" means up to the end of the 14th.
            lt: filter.to ? new Date(startOfDay(filter.to).getTime() + 86_400_000) : undefined,
          },
        }
      : {}),
  };
}

const SELECT = {
  id: true,
  action: true,
  actorRole: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  actor: { select: { name: true } },
} satisfies Prisma.ActivityLogSelect;

export type ActivityLogRecord = Prisma.ActivityLogGetPayload<{ select: typeof SELECT }> & {
  /** What the entry is about, in words: a reference, a name, a type. */
  subject: string | null;
};

export async function findActivity(
  filter: ActivityFilter = {},
): Promise<{ items: ActivityLogRecord[]; total: number; page: number; pages: number }> {
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const [rows, total] = await Promise.all([
    db.activityLog.findMany({
      where: where(filter),
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
      select: SELECT,
    }),
    db.activityLog.count({ where: where(filter) }),
  ]);

  // The log stores only ids; look the subjects up in three queries, not N.
  const ids = (type: string) => [
    ...new Set(rows.filter((row) => row.entityType === type).map((row) => row.entityId)),
  ];
  const [submissions, users, types] = await Promise.all([
    db.submission.findMany({
      where: { id: { in: ids("Submission") } },
      select: { id: true, reference: true },
    }),
    db.user.findMany({ where: { id: { in: ids("User") } }, select: { id: true, name: true } }),
    db.documentType.findMany({
      where: { id: { in: ids("DocumentType") } },
      select: { id: true, name: true },
    }),
  ]);
  const subject = new Map<string, string>([
    ...submissions.map((row) => [row.id, row.reference] as const),
    ...users.map((row) => [row.id, row.name] as const),
    ...types.map((row) => [row.id, row.name] as const),
  ]);

  return {
    items: rows.map((row) => ({ ...row, subject: subject.get(row.entityId) ?? null })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE)),
  };
}
