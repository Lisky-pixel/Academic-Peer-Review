import { db } from "@/lib/db";
import { kickEmailDispatch } from "@/lib/email/outbox";
import type { Prisma, Role, SubmissionStatus } from "@/lib/generated/prisma/client";
import { findAdminIds, type Notice, queueNotices } from "@/lib/notifications";
import { type Message, type SubmissionRef, toAdmin, toAuthor } from "@/lib/notifications/messages";
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
 *   4. queues the notifications — in-app and email — for the author and the
 *      administrators.
 *
 * Callers that must write other rows as part of the same move — an
 * Assignment when assigning, say, or a notice to the reviewer — pass `apply`,
 * which runs inside the same transaction after the status has changed.
 *
 * Email is only queued here. Once the transaction has committed, sending is
 * started in the background; see lib/email/outbox.ts.
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

/**
 * What the author is told, per event. The builders take only a reference, a
 * title and an id — see lib/notifications/messages.ts — so nothing here can
 * carry a reviewer's identity.
 */
const AUTHOR_MESSAGE: Partial<Record<WorkflowEvent, (submission: SubmissionRef) => Message>> = {
  submit: toAuthor.submissionReceived,
  assign: toAuthor.reviewerAssigned,
  approve: toAuthor.reviewReady,
  cancel: toAuthor.cancelled,
};

/** What every administrator is told, per event. */
const ADMIN_MESSAGE: Partial<Record<WorkflowEvent, (submission: SubmissionRef) => Message>> = {
  submit: toAdmin.submissionCreated,
  accept: toAdmin.assignmentAccepted,
  decline: toAdmin.assignmentDeclined,
  submit_review: (submission) => toAdmin.reviewSubmitted(submission, false),
  resubmit_review: (submission) => toAdmin.reviewSubmitted(submission, true),
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

  const result = await db.$transaction(async (tx): Promise<TransitionResult> => {
    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        authorId: true,
        assignments: { where: { isActive: true }, select: { reviewerId: true } },
      },
    });
    if (!submission) return { ok: false, reason: "not_found" };

    const decision = decideTransition(submission.status, event, actor.role);
    if (!decision.ok) return decision;

    // The table says which *role* may act; these say which *person*.
    if (actor.role === AUTHOR_ONLY_ROLE && submission.authorId !== actor.id) {
      return { ok: false, reason: "not_yours" };
    }
    if (
      actor.role === REVIEWER_ROLE &&
      !submission.assignments.some((assignment) => assignment.reviewerId === actor.id)
    ) {
      return { ok: false, reason: "not_yours" };
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
    if (count !== 1) return { ok: false, reason: "changed_meanwhile" };

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

    const ref: SubmissionRef = {
      id: submission.id,
      reference: submission.reference,
      title: submission.title,
    };
    const notices: Notice[] = [];

    const authorMessage = AUTHOR_MESSAGE[event]?.(ref);
    // Nobody needs telling about something they just did themselves.
    if (authorMessage && !(event === "cancel" && actor.id === submission.authorId)) {
      notices.push({
        userId: submission.authorId,
        submissionId: submission.id,
        message: authorMessage,
      });
    }

    const adminMessage = ADMIN_MESSAGE[event]?.(ref);
    if (adminMessage) {
      for (const adminId of await findAdminIds(tx)) {
        notices.push({ userId: adminId, submissionId: submission.id, message: adminMessage });
      }
    }

    await queueNotices(tx, notices);

    return { ok: true, from: submission.status, to: decision.to };
  });

  if (result.ok) kickEmailDispatch();
  return result;
}
