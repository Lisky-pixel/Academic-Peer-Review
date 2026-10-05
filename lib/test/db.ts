import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Support for tests that run against a real Postgres.
 *
 * Some rules in this codebase are enforced by the database itself — the
 * atomic rate-limit upsert, single-use tokens — and a mock would only test
 * the mock. These tests use whatever DATABASE_URL points at (the dev database
 * unless .env.test.local says otherwise), so they confine themselves to rows
 * they create, under an email domain nothing else uses, and remove them after.
 */

const TEST_EMAIL_DOMAIN = "@reviewflow-test.invalid";

/**
 * Identifies the accounts made by this test file. Vitest runs files in
 * parallel, each with its own copy of this module, so cleaning up "every test
 * account" from one file would delete accounts another file is still using.
 */
const RUN_TAG = randomUUID().slice(0, 8);

/** Leftovers older than this belong to a run that has certainly finished. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * False when Postgres is not reachable, so those suites skip with a warning
 * instead of failing every `pnpm test` run on a machine without Docker up.
 */
export const dbAvailable: boolean = await db.$queryRaw`SELECT 1`.then(
  () => true,
  () => {
    console.warn("\n⚠ Postgres is not reachable — database tests are being SKIPPED.\n");
    return false;
  },
);

export function testEmail(label = "user"): string {
  return `${label}-${RUN_TAG}-${randomUUID()}${TEST_EMAIL_DOMAIN}`;
}

/** A unique stand-in for a client IP, so rate-limit buckets never collide. */
export function testIp(): string {
  return `test-ip-${randomUUID()}`;
}

/**
 * Removes the accounts this file created, plus any test accounts old enough
 * to be debris from a crashed run or from the browser tests, which have no
 * database access of their own to tidy up with.
 */
export async function cleanUpTestUsers(): Promise<void> {
  const users = await db.user.findMany({
    where: {
      email: { endsWith: TEST_EMAIL_DOMAIN },
      OR: [
        { email: { contains: `-${RUN_TAG}-` } },
        { createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
      ],
    },
    select: { id: true },
  });
  await purgeUsers(users.map((user) => user.id));
}

/**
 * Deletes users together with everything that hangs off them. Facts are
 * protected by onDelete: Restrict on purpose, so removing a test account
 * means removing its submissions and their rows first, in dependency order.
 * For test data only — nothing in the application deletes like this.
 */
export async function purgeUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const submissions = await db.submission.findMany({
    where: { authorId: { in: userIds } },
    select: { id: true },
  });
  const submissionIds = submissions.map((submission) => submission.id);

  // Queued email for these accounts. Left behind, it would be picked up and
  // sent by the development server the next time it dispatches mail.
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { email: true },
  });
  await db.emailLog.deleteMany({
    where: {
      OR: [
        { submissionId: { in: submissionIds } },
        { toEmail: { in: users.map((user) => user.email) } },
      ],
    },
  });

  await db.activityLog.deleteMany({ where: { entityId: { in: [...userIds, ...submissionIds] } } });
  await db.notification.deleteMany({ where: { submissionId: { in: submissionIds } } });
  // Reviews hang off assignments, and decisions off reviews. A reviewer or an
  // administrator being purged may have these on submissions that are staying,
  // so match on the person as well as on the submission.
  const reviewScope = {
    OR: [
      { submissionId: { in: submissionIds } },
      { assignment: { reviewerId: { in: userIds } } },
      { assignment: { assignedById: { in: userIds } } },
    ],
  };
  await db.adminDecision.deleteMany({
    where: { OR: [{ adminId: { in: userIds } }, { review: reviewScope }] },
  });
  // Responses cascade with their review.
  await db.review.deleteMany({ where: reviewScope });
  await db.assignment.deleteMany({
    where: {
      OR: [
        { submissionId: { in: submissionIds } },
        { reviewerId: { in: userIds } },
        { assignedById: { in: userIds } },
      ],
    },
  });
  await db.storedFile.deleteMany({
    where: { OR: [{ submissionId: { in: submissionIds } }, { uploadedById: { in: userIds } }] },
  });
  await db.submission.deleteMany({ where: { id: { in: submissionIds } } });
  // Sessions, tokens and notifications addressed to the user cascade.
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}
