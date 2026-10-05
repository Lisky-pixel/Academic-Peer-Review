import { db } from "@/lib/db";
import type {
  NotificationType,
  Prisma,
  Role,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";
import {
  type ActorRole,
  decideTransition,
  type TransitionDenial,
  type WorkflowEvent,
} from "@/lib/workflow/transitions";

/**
 * The submission state machine. The only code allowed to change
 * `Submission.status`.
 *
 * `transition()` does four things in one database transaction, so they
 * succeed or fail together:
 *
 *   1. checks the move is legal from the current status, for this actor's
 *      role, and that this particular person is entitled to make it;
 *   2. updates the status and the timestamp that goes with it;
 *   3. writes the activity log entry;
 *   4. queues in-app notifications for whoever needs to know.
 *
 * Callers that must write other rows as part of the same move — an
 * Assignment when assigning, say — pass `apply`, which runs inside the same
 * transaction after the status has changed.
 */

export type Actor = { id: string; role: Role } | { id: null; role: "SYSTEM" };

export const SYSTEM_ACTOR: Actor = { id: null, role: "SYSTEM" };

export type TransitionFailure = TransitionDenial | "not_found" | "not_yours" | "changed_meanwhile";

export type TransitionResult =
  | { ok: true; from: SubmissionStatus; to: SubmissionStatus }
  | { ok: false; reason: TransitionFailure };

/** The timestamp column each event stamps, if any. */
const TIMESTAMP: Partial<
  Record<WorkflowEvent, "submittedAt" | "approvedAt" | "deliveredAt" | "cancelledAt">
> = {
  submit: "submittedAt",
  approve: "approvedAt",
  deliver: "deliveredAt",
  cancel: "cancelledAt",
};

type Notice = { type: NotificationType; title: string; body: string };

/**
 * What the author is told. Deliberately says nothing about who is involved:
 * these strings are user-facing and must never carry a reviewer's identity.
 */
const AUTHOR_NOTICE: Partial<Record<WorkflowEvent, (reference: string) => Notice>> = {
  submit: (reference) => ({
    type: "SUBMISSION_RECEIVED",
    title: "We have your submission",
    body: `${reference} is waiting to be matched with a reviewer.`,
  }),
  assign: (reference) => ({
    type: "SUBMISSION_STATUS_CHANGED",
    title: "A reviewer has been assigned",
    body: `${reference} has been matched with a reviewer.`,
  }),
  approve: (reference) => ({
    type: "REVIEW_READY",
    title: "Your review is ready",
    body: `The review of ${reference} is ready to read.`,
  }),
  cancel: (reference) => ({
    type: "SUBMISSION_STATUS_CHANGED",
    title: "Submission cancelled",
    body: `${reference} has been cancelled.`,
  }),
};

/** What every administrator is told. */
const ADMIN_NOTICE: Partial<Record<WorkflowEvent, (reference: string) => Notice>> = {
  submit: (reference) => ({
    type: "SUBMISSION_CREATED",
    title: "New submission",
    body: `${reference} needs a reviewer.`,
  }),
  accept: (reference) => ({
    type: "ASSIGNMENT_ANSWERED",
    title: "Assignment accepted",
    body: `The reviewer accepted ${reference}.`,
  }),
  decline: (reference) => ({
    type: "ASSIGNMENT_ANSWERED",
    title: "Assignment declined",
    body: `The reviewer declined ${reference}. It needs a new reviewer.`,
  }),
  submit_review: (reference) => ({
    type: "REVIEW_SUBMITTED",
    title: "Review ready for approval",
    body: `The review of ${reference} is waiting for you.`,
  }),
  resubmit_review: (reference) => ({
    type: "REVIEW_SUBMITTED",
    title: "Revised review ready for approval",
    body: `The revised review of ${reference} is waiting for you.`,
  }),
};

/** Events only the submission's author may make. */
const AUTHOR_ONLY_ROLE: ActorRole = "USER";
/** Events only the currently assigned reviewer may make. */
const REVIEWER_ROLE: ActorRole = "REVIEWER";

export async function transition(input: {
  submissionId: string;
  event: WorkflowEvent;
  actor: Actor;
  /** Extra detail for the activity log, e.g. a decline reason. */
  metadata?: Prisma.InputJsonObject;
  ip?: string | null;
  /** Further writes that belong to this move, run in the same transaction. */
  apply?: (tx: Prisma.TransactionClient) => Promise<void>;
}): Promise<TransitionResult> {
  const { submissionId, event, actor } = input;

  return db.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        reference: true,
        status: true,
        authorId: true,
        assignments: { where: { isActive: true }, select: { reviewerId: true } },
      },
    });
    if (!submission) return { ok: false, reason: "not_found" } as const;

    const decision = decideTransition(submission.status, event, actor.role);
    if (!decision.ok) return decision;

    // The table says which *role* may act; these say which *person*.
    if (actor.role === AUTHOR_ONLY_ROLE && submission.authorId !== actor.id) {
      return { ok: false, reason: "not_yours" } as const;
    }
    if (
      actor.role === REVIEWER_ROLE &&
      !submission.assignments.some((assignment) => assignment.reviewerId === actor.id)
    ) {
      return { ok: false, reason: "not_yours" } as const;
    }

    const now = new Date();
    const stamp = TIMESTAMP[event];

    // The current status is part of the WHERE, so if two requests race — a
    // double click, or an admin and a reviewer acting at once — exactly one
    // of them changes the row and the other is told it lost.
    const { count } = await tx.submission.updateMany({
      where: { id: submission.id, status: submission.status },
      data: { status: decision.to, ...(stamp ? { [stamp]: now } : {}) },
    });
    if (count !== 1) return { ok: false, reason: "changed_meanwhile" } as const;

    await input.apply?.(tx);

    await tx.activityLog.create({
      data: {
        action: `submission.${event}`,
        entityType: "Submission",
        entityId: submission.id,
        actorId: actor.id,
        actorRole: actor.role === "SYSTEM" ? null : actor.role,
        ip: input.ip ?? null,
        metadata: { from: submission.status, to: decision.to, ...input.metadata },
      },
    });

    const notifications: Prisma.NotificationCreateManyInput[] = [];

    const authorNotice = AUTHOR_NOTICE[event]?.(submission.reference);
    // Nobody needs telling about something they just did themselves.
    if (authorNotice && !(event === "cancel" && actor.id === submission.authorId)) {
      notifications.push({
        ...authorNotice,
        userId: submission.authorId,
        submissionId: submission.id,
        linkUrl: `/dashboard/submissions/${submission.id}`,
      });
    }

    const adminNotice = ADMIN_NOTICE[event]?.(submission.reference);
    if (adminNotice) {
      const admins = await tx.user.findMany({
        where: { role: "ADMIN", status: "ACTIVE" },
        select: { id: true },
      });
      for (const admin of admins) {
        notifications.push({
          ...adminNotice,
          userId: admin.id,
          submissionId: submission.id,
          linkUrl: `/admin/submissions/${submission.id}`,
        });
      }
    }

    if (notifications.length > 0) await tx.notification.createMany({ data: notifications });

    return { ok: true, from: submission.status, to: decision.to } as const;
  });
}
