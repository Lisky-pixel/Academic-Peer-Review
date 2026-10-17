import { db } from "@/lib/db";
import { kickEmailDispatch } from "@/lib/email/outbox";
import type { Prisma, Role, SubmissionStatus } from "@/lib/generated/prisma/client";
import { findOrganiserIds, type Notice, queueNotices } from "@/lib/notifications";
import { type SubmissionRef, toOrganiser, toSubmitter } from "@/lib/notifications/messages";
import {
  type Capacity,
  decideTransition,
  type TransitionDenial,
  type WorkflowEvent,
} from "@/lib/workflow/transitions";

/**
 * The paper state machine. The only code allowed to change
 * `Submission.status`.
 *
 * `transition()` does four things in one database transaction, so they
 * succeed or fail together:
 *
 *   1. works out in what capacity the actor stands to this paper (its
 *      submitter, an organiser of its conference, one of its reviewers) and
 *      checks the move is legal from the current status in that capacity;
 *   2. updates the status and the timestamp that goes with it;
 *   3. writes the activity log entry;
 *   4. queues the notifications — in-app and email — that the move causes.
 *
 * Callers that must write other rows as part of the same move — the
 * assignments when reviewers are matched, say — pass `apply`, which runs
 * inside the same transaction after the status has changed.
 *
 * Email is only queued here. Once the transaction has committed, sending is
 * started in the background; see lib/email/outbox.ts.
 */

export type Actor = { id: string; role: Role } | { id: null; role: "SYSTEM" };

export const SYSTEM_ACTOR: Actor = { id: null, role: "SYSTEM" };

export type TransitionFailure = TransitionDenial | "not_found" | "changed_meanwhile";

export type TransitionResult =
  | { ok: true; from: SubmissionStatus; to: SubmissionStatus }
  | { ok: false; reason: TransitionFailure };

type Stamp = "submittedAt" | "reviewsCompletedAt" | "decidedAt" | "withdrawnAt";

/** The timestamp column each event stamps, if any. */
const TIMESTAMP: Partial<Record<WorkflowEvent, Stamp>> = {
  submit: "submittedAt",
  complete_reviews: "reviewsCompletedAt",
  accept: "decidedAt",
  reject: "decidedAt",
  withdraw: "withdrawnAt",
};

/** The capacities in which `actor` stands to a paper. */
async function capacitiesOf(
  tx: Prisma.TransactionClient,
  actor: Actor,
  paper: { id: string; authorId: string; conferenceId: string },
): Promise<Capacity[]> {
  if (actor.id === null) return ["SYSTEM"];

  const capacities: Capacity[] = [];
  if (paper.authorId === actor.id) capacities.push("SUBMITTER");

  if (actor.role === "ADMIN") {
    capacities.push("ORGANISER");
  } else if (actor.role === "ORGANISER") {
    const organises = await tx.conferenceOrganiser.count({
      where: { conferenceId: paper.conferenceId, userId: actor.id },
    });
    if (organises > 0) capacities.push("ORGANISER");
  }

  const reviews = await tx.assignment.count({
    where: {
      submissionId: paper.id,
      reviewerId: actor.id,
      status: { in: ["PENDING", "ACCEPTED", "COMPLETED"] },
    },
  });
  if (reviews > 0) capacities.push("REVIEWER");

  return capacities;
}

export async function transition(input: {
  submissionId: string;
  event: WorkflowEvent;
  actor: Actor;
  /** Extra detail for the activity log, e.g. a decision note. */
  metadata?: Prisma.InputJsonObject;
  ip?: string | null;
  /** Further writes that belong to this move, run in the same transaction. */
  apply?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Run inside an existing transaction instead of opening one. */
  tx?: Prisma.TransactionClient;
}): Promise<TransitionResult> {
  const { submissionId, event, actor } = input;

  const run = async (tx: Prisma.TransactionClient): Promise<TransitionResult> => {
    const paper = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        authorId: true,
        conferenceId: true,
        conference: { select: { name: true } },
      },
    });
    if (!paper) return { ok: false, reason: "not_found" };

    const decision = decideTransition(paper.status, event, await capacitiesOf(tx, actor, paper));
    if (!decision.ok) return decision;

    const now = new Date();
    const stamp = TIMESTAMP[event];

    // The current status is part of the WHERE, so if two requests race — a
    // double click, or two organisers deciding at once — exactly one of them
    // changes the row and the other is told it lost.
    const { count } = await tx.submission.updateMany({
      where: { id: paper.id, status: paper.status },
      data: {
        status: decision.to,
        ...(stamp ? { [stamp]: now } : {}),
        ...(event === "accept" || event === "reject" ? { decidedById: actor.id } : {}),
      },
    });
    if (count !== 1) return { ok: false, reason: "changed_meanwhile" };

    await input.apply?.(tx);

    await tx.activityLog.create({
      data: {
        action: `submission.${event}`,
        entityType: "Submission",
        entityId: paper.id,
        actorId: actor.id,
        actorRole: actor.role === "SYSTEM" ? null : actor.role,
        ip: input.ip ?? null,
        metadata: { from: paper.status, to: decision.to, as: decision.as, ...input.metadata },
      },
    });

    const ref: SubmissionRef = {
      id: paper.id,
      reference: paper.reference,
      title: paper.title,
      conferenceId: paper.conferenceId,
    };
    const conferenceName = paper.conference.name;
    const notices: Notice[] = [];

    if (event === "submit") {
      notices.push({
        userId: paper.authorId,
        submissionId: paper.id,
        message: toSubmitter.submissionReceived(ref, conferenceName),
      });
    }
    if (event === "accept" || event === "reject") {
      notices.push({
        userId: paper.authorId,
        submissionId: paper.id,
        message: toSubmitter.decisionMade(ref, event === "accept", conferenceName),
      });
    }
    if (event === "complete_reviews") {
      for (const userId of await findOrganiserIds(tx, paper.conferenceId)) {
        notices.push({
          userId,
          submissionId: paper.id,
          message: toOrganiser.reviewsComplete(ref),
        });
      }
    }

    await queueNotices(tx, notices);

    return { ok: true, from: paper.status, to: decision.to };
  };

  if (input.tx) return run(input.tx);

  const result = await db.$transaction(run);
  if (result.ok) kickEmailDispatch();
  return result;
}
