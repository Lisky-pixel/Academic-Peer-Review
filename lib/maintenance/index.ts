import { deleteStaleUnverifiedUsers } from "@/lib/auth/registration";
import { deleteExpiredSessions } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dispatchQueuedEmails } from "@/lib/email/outbox";
import { formatDate } from "@/lib/format";
import type { NotificationType, Prisma } from "@/lib/generated/prisma/client";
import { runMatching } from "@/lib/matching";
import { findOrganiserIds, type Notice, queueNotices } from "@/lib/notifications";
import { toOrganiser, toReviewer } from "@/lib/notifications/messages";
import { deleteExpiredRateLimits } from "@/lib/rate-limit";
import { SYSTEM_ACTOR } from "@/lib/workflow/state-machine";

/**
 * The scheduled job: everything that has to happen because time passed
 * rather than because somebody clicked.
 *
 *   - match reviewers to papers in conferences whose call has just closed
 *   - remind reviewers three times before a review is due
 *   - tell organisers about reviews that are overdue
 *   - retry email that failed to send
 *   - delete expired sessions, rate-limit windows, used tokens and
 *     registrations that were never confirmed
 *
 * Every step is safe to run twice.
 */

const DAY_MS = 86_400_000;

/** Reminders go this many days before the due date. */
export const REMINDER_DAYS = [7, 3, 1] as const;

/**
 * How many reminders should have gone by now for a review due at `dueAt`:
 * one once it is within seven days, two within three, three within one.
 */
export function remindersDue(dueAt: Date, now: Date): number {
  const daysLeft = (dueAt.getTime() - now.getTime()) / DAY_MS;
  if (daysLeft <= 0) return 0;
  return REMINDER_DAYS.filter((days) => daysLeft <= days).length;
}

/** A review still in the reviewer's hands, on a paper still under review. */
const OPEN_ASSIGNMENT = {
  status: { in: ["PENDING", "ACCEPTED"] },
  submission: { status: "UNDER_REVIEW" },
} satisfies Prisma.AssignmentWhereInput;

const ASSIGNMENT_SELECT = {
  id: true,
  reviewerId: true,
  dueAt: true,
  assignedAt: true,
  remindersSent: true,
  submission: { select: { id: true, reference: true, title: true, conferenceId: true } },
} satisfies Prisma.AssignmentSelect;

/** Sends each reviewer the reminders that have come due: at 7, 3 and 1 days. */
export async function sendDeadlineReminders(
  now: Date = new Date(),
  /** Narrows which assignments are considered. Tests use it to stay in their lane. */
  scope: Prisma.AssignmentWhereInput = {},
): Promise<number> {
  const open = await db.assignment.findMany({
    where: {
      ...OPEN_ASSIGNMENT,
      AND: scope,
      dueAt: { gt: now, lte: new Date(now.getTime() + REMINDER_DAYS[0] * DAY_MS) },
    },
    select: ASSIGNMENT_SELECT,
  });

  let sent = 0;
  for (const assignment of open) {
    const due = remindersDue(assignment.dueAt, now);
    if (due <= assignment.remindersSent) continue;

    sent += await db.$transaction(async (tx) => {
      // The count is part of the WHERE: two overlapping runs cannot both send.
      const { count } = await tx.assignment.updateMany({
        where: { id: assignment.id, remindersSent: assignment.remindersSent },
        data: { remindersSent: due },
      });
      if (count !== 1) return 0;

      const daysLeft = Math.ceil((assignment.dueAt.getTime() - now.getTime()) / DAY_MS);
      await queueNotices(tx, [
        {
          userId: assignment.reviewerId,
          submissionId: assignment.submission.id,
          message: toReviewer.deadlineApproaching(
            assignment.submission,
            formatDate(assignment.dueAt),
            daysLeft,
          ),
        },
      ]);
      return 1;
    });
  }
  return sent;
}

/** Whether `userId` has already been sent this kind of notice since `since`. */
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

/** Tells the organisers, once, about each review that is past its due date. */
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
      for (const userId of await findOrganiserIds(tx, submission.conferenceId)) {
        if (await alreadyTold(tx, userId, submission.id, "REVIEW_OVERDUE", assignment.assignedAt)) {
          continue;
        }
        notices.push({
          userId,
          submissionId: submission.id,
          message: toOrganiser.reviewOverdue(submission, formatDate(assignment.dueAt)),
        });
      }
      await queueNotices(tx, notices);
      return notices.length > 0 ? 1 : 0;
    });
  }
  return escalated;
}

/**
 * Matches reviewers in every conference whose call for papers has closed and
 * that has not been matched since. Organisers can also run matching early
 * from the conference page.
 */
export async function matchClosedConferences(now: Date = new Date()): Promise<number> {
  const due = await db.conference.findMany({
    where: {
      submissionsCloseAt: { lte: now },
      OR: [{ matchedAt: null }, { matchedAt: { lt: db.conference.fields.submissionsCloseAt } }],
    },
    select: { id: true },
  });
  let papers = 0;
  for (const conference of due) {
    papers += (await runMatching(conference.id, SYSTEM_ACTOR)).papers;
  }
  return papers;
}

/** Removes single-use tokens that are spent or expired; they can never be used again. */
export async function deleteDeadTokens(now: Date = new Date()): Promise<number> {
  const { count } = await db.token.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }] },
  });
  return count;
}

export type MaintenanceReport = {
  papersMatched: number;
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

  const papersMatched = await attempt("matching", () => matchClosedConferences(now), 0);
  const remindersSent = await attempt("reminders", () => sendDeadlineReminders(now), 0);
  const overdueEscalated = await attempt("overdue", () => escalateOverdueReviews(now), 0);
  // After the steps above, so the mail they queued goes out in this run.
  const emails = await attempt("email", () => dispatchQueuedEmails(200), { sent: 0, failed: 0 });

  return {
    papersMatched,
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
