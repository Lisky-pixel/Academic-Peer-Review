import { deleteStaleUnverifiedUsers } from "@/lib/auth/registration";
import { deleteExpiredSessions } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dispatchQueuedEmails } from "@/lib/email/outbox";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import type { NotificationType, Prisma } from "@/lib/generated/prisma/client";
import { findAdminIds, type Notice, queueNotices } from "@/lib/notifications";
import { toAdmin, toReviewer } from "@/lib/notifications/messages";
import { deleteExpiredRateLimits } from "@/lib/rate-limit";

/**
 * The scheduled job: everything that has to happen because time passed
 * rather than because somebody clicked.
 *
 *   - remind reviewers whose review is due soon
 *   - tell administrators about reviews that are overdue
 *   - retry email that failed to send
 *   - delete expired sessions, rate-limit windows, used tokens and
 *     registrations that were never confirmed
 *
 * Every step is safe to run twice. Reminders are sent once per assignment:
 * before sending one, the job checks whether that person already has that
 * kind of notification for that submission since the assignment was made.
 */

const DAY_MS = 86_400_000;

/** A review still in the reviewer's hands. */
const OPEN_ASSIGNMENT = {
  isActive: true,
  status: { in: ["PENDING", "ACCEPTED"] },
  submission: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_REVIEW", "REVISION_REQUESTED"] } },
} satisfies Prisma.AssignmentWhereInput;

const ASSIGNMENT_SELECT = {
  reviewerId: true,
  dueAt: true,
  assignedAt: true,
  submission: { select: { id: true, reference: true, title: true } },
} satisfies Prisma.AssignmentSelect;

async function reminderLeadDays(): Promise<number> {
  const setting = await db.appSetting.findUnique({ where: { key: "deadlineReminderLeadDays" } });
  return typeof setting?.value === "number" && setting.value > 0
    ? setting.value
    : env.DEADLINE_REMINDER_LEAD_DAYS;
}

/** Whether `userId` has already been sent this kind of notice for this assignment. */
async function alreadyTold(
  tx: Prisma.TransactionClient,
  userId: string,
  submissionId: string,
  type: NotificationType,
  since: Date,
): Promise<boolean> {
  return (
    (await tx.notification.count({
      where: { userId, submissionId, type, createdAt: { gte: since } },
    })) > 0
  );
}

/** Reminds each reviewer once that a review is due within the lead time. */
export async function sendDeadlineReminders(
  now: Date = new Date(),
  /** Narrows which assignments are considered. Tests use it to stay in their lane. */
  scope: Prisma.AssignmentWhereInput = {},
): Promise<number> {
  const leadDays = await reminderLeadDays();
  const due = await db.assignment.findMany({
    where: {
      ...OPEN_ASSIGNMENT,
      AND: scope,
      dueAt: { gt: now, lte: new Date(now.getTime() + leadDays * DAY_MS) },
    },
    select: ASSIGNMENT_SELECT,
  });

  let sent = 0;
  for (const assignment of due) {
    const { submission, reviewerId } = assignment;
    // One short transaction per reminder: the "already told?" check and the
    // insert happen together, so two overlapping runs cannot both send it.
    sent += await db.$transaction(async (tx) => {
      if (
        await alreadyTold(
          tx,
          reviewerId,
          submission.id,
          "DEADLINE_APPROACHING",
          assignment.assignedAt,
        )
      ) {
        return 0;
      }
      await queueNotices(tx, [
        {
          userId: reviewerId,
          submissionId: submission.id,
          message: toReviewer.deadlineApproaching(submission, formatDate(assignment.dueAt!)),
        },
      ]);
      return 1;
    });
  }
  return sent;
}

/** Tells every administrator, once, about each review that is past its due date. */
export async function escalateOverdueReviews(
  now: Date = new Date(),
  scope: Prisma.AssignmentWhereInput = {},
): Promise<number> {
  const overdue = await db.assignment.findMany({
    where: { ...OPEN_ASSIGNMENT, AND: scope, dueAt: { lt: now } },
    select: ASSIGNMENT_SELECT,
  });

  let escalated = 0;
  for (const assignment of overdue) {
    const { submission } = assignment;
    escalated += await db.$transaction(async (tx) => {
      const notices: Notice[] = [];
      for (const adminId of await findAdminIds(tx)) {
        if (
          await alreadyTold(tx, adminId, submission.id, "REVIEW_OVERDUE", assignment.assignedAt)
        ) {
          continue;
        }
        notices.push({
          userId: adminId,
          submissionId: submission.id,
          message: toAdmin.reviewOverdue(submission, formatDate(assignment.dueAt!)),
        });
      }
      await queueNotices(tx, notices);
      return notices.length > 0 ? 1 : 0;
    });
  }
  return escalated;
}

/** Removes single-use tokens that are spent or expired; they can never be used again. */
export async function deleteDeadTokens(now: Date = new Date()): Promise<number> {
  const { count } = await db.token.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }] },
  });
  return count;
}

export type MaintenanceReport = {
  remindersSent: number;
  overdueEscalated: number;
  emailsSent: number;
  emailsFailed: number;
  expiredSessions: number;
  expiredRateLimits: number;
  deadTokens: number;
  staleRegistrations: number;
};

/**
 * Runs every step. A failure in one is logged and does not stop the others:
 * a mail outage must not prevent sessions from being cleaned up.
 */
export async function runMaintenance(now: Date = new Date()): Promise<MaintenanceReport> {
  const attempt = async <T>(name: string, step: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      console.error(`Maintenance step "${name}" failed`, error);
      return fallback;
    }
  };

  const remindersSent = await attempt("reminders", () => sendDeadlineReminders(now), 0);
  const overdueEscalated = await attempt("overdue", () => escalateOverdueReviews(now), 0);
  // After the two steps above, so the mail they queued goes out in this run.
  const emails = await attempt("email", () => dispatchQueuedEmails(100), { sent: 0, failed: 0 });

  return {
    remindersSent,
    overdueEscalated,
    emailsSent: emails.sent,
    emailsFailed: emails.failed,
    expiredSessions: await attempt("sessions", deleteExpiredSessions, 0),
    expiredRateLimits: await attempt("rate limits", deleteExpiredRateLimits, 0),
    deadTokens: await attempt("tokens", () => deleteDeadTokens(now), 0),
    staleRegistrations: await attempt("registrations", deleteStaleUnverifiedUsers, 0),
  };
}
