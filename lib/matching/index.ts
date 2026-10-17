import { db } from "@/lib/db";
import { kickEmailDispatch } from "@/lib/email/outbox";
import { formatDate } from "@/lib/format";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  type Candidate,
  dueDateFor,
  eligibleReviewers,
  needsTiebreaker,
  pickReviewers,
} from "@/lib/matching/select";
import { findOrganiserIds, type Notice, queueNotices } from "@/lib/notifications";
import { type SubmissionRef, toOrganiser, toReviewer } from "@/lib/notifications/messages";
import { type Actor, SYSTEM_ACTOR, transition } from "@/lib/workflow/state-machine";

/**
 * Giving papers to reviewers, and noticing when a paper's reviews are done.
 *
 * Every function that assigns holds a per-conference lock for the length of
 * its transaction, so two matching runs — or a run and a reviewer declining
 * at the same moment — cannot both count a reviewer as having room and give
 * them more papers than the conference allows.
 *
 * The rules for who may be chosen are in lib/matching/select.ts.
 */

/** Assignments that still count: offered, being worked on, or done. */
export const LIVE_ASSIGNMENT = ["PENDING", "ACCEPTED", "COMPLETED"] as const;

class RollBack extends Error {}

async function lockConference(tx: Prisma.TransactionClient, conferenceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${conferenceId}))`;
}

const PAPER_SELECT = {
  id: true,
  reference: true,
  title: true,
  status: true,
  authorId: true,
  institution: true,
  disciplineId: true,
  conferenceId: true,
  author: { select: { institution: true } },
  conference: {
    select: { reviewersPerPaper: true, maxPapersPerReviewer: true, reviewDeadline: true },
  },
  assignments: { select: { reviewerId: true, status: true, isTiebreaker: true } },
} satisfies Prisma.SubmissionSelect;

type PaperForMatching = Prisma.SubmissionGetPayload<{ select: typeof PAPER_SELECT }>;

function refOf(paper: PaperForMatching): SubmissionRef {
  return {
    id: paper.id,
    reference: paper.reference,
    title: paper.title,
    conferenceId: paper.conferenceId,
  };
}

/** Every active reviewer, with how many papers they hold in this conference. */
async function loadCandidates(
  tx: Prisma.TransactionClient,
  conferenceId: string,
): Promise<Candidate[]> {
  // One after the other: a transaction is a single connection, and
  // overlapping queries on it are not allowed.
  const reviewers = await tx.user.findMany({
    where: { role: "REVIEWER", status: "ACTIVE", reviewerProfile: { isNot: null } },
    select: {
      id: true,
      institution: true,
      reviewerProfile: { select: { disciplines: { select: { id: true } } } },
    },
  });
  const loads = await tx.assignment.groupBy({
    by: ["reviewerId"],
    where: { status: { in: [...LIVE_ASSIGNMENT] }, submission: { conferenceId } },
    _count: { _all: true },
  });
  const loadOf = new Map(loads.map((row) => [row.reviewerId, row._count._all]));

  return reviewers.map((reviewer) => ({
    id: reviewer.id,
    institution: reviewer.institution,
    disciplineIds: reviewer.reviewerProfile?.disciplines.map((discipline) => discipline.id) ?? [],
    load: loadOf.get(reviewer.id) ?? 0,
  }));
}

export type FillResult = { assigned: string[]; missing: number };

/**
 * Fills a paper's open reviewer places from the pool, inside the caller's
 * transaction. With `tiebreaker`, adds exactly one extra reviewer, marked as
 * the tie-breaker. Tells the organisers when places could not be filled.
 */
export async function fillReviewerPlaces(
  tx: Prisma.TransactionClient,
  submissionId: string,
  actor: Actor,
  options: { tiebreaker?: boolean; now?: Date } = {},
): Promise<FillResult> {
  const paper = await tx.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: PAPER_SELECT,
  });
  await lockConference(tx, paper.conferenceId);

  const live = paper.assignments.filter((assignment) =>
    (LIVE_ASSIGNMENT as readonly string[]).includes(assignment.status),
  );
  const needed = options.tiebreaker
    ? 1
    : paper.conference.reviewersPerPaper -
      live.filter((assignment) => !assignment.isTiebreaker).length;
  if (needed <= 0) return { assigned: [], missing: 0 };

  const eligible = eligibleReviewers({
    candidates: await loadCandidates(tx, paper.conferenceId),
    disciplineId: paper.disciplineId,
    excludedInstitutions: [paper.institution, paper.author.institution],
    excludedIds: [paper.authorId, ...paper.assignments.map((assignment) => assignment.reviewerId)],
    maxLoad: paper.conference.maxPapersPerReviewer,
  });
  const chosen = pickReviewers(eligible, needed);

  const now = options.now ?? new Date();
  const dueAt = dueDateFor(paper.conference.reviewDeadline, now);
  const ref = refOf(paper);
  const notices: Notice[] = [];

  for (const reviewerId of chosen) {
    const assignment = await tx.assignment.create({
      data: {
        submissionId: paper.id,
        reviewerId,
        assignedById: actor.id,
        isTiebreaker: options.tiebreaker ?? false,
        dueAt,
      },
      select: { id: true },
    });
    await tx.activityLog.create({
      data: {
        action: "assignment.created",
        entityType: "Submission",
        entityId: paper.id,
        actorId: actor.id,
        actorRole: actor.role === "SYSTEM" ? null : actor.role,
        metadata: {
          assignmentId: assignment.id,
          reviewerId,
          automatic: true,
          tiebreaker: options.tiebreaker ?? false,
        },
      },
    });
    notices.push({
      userId: reviewerId,
      submissionId: paper.id,
      message: toReviewer.assignmentReceived(ref, formatDate(dueAt)),
    });
  }

  const missing = needed - chosen.length;
  if (missing > 0) {
    for (const userId of await findOrganiserIds(tx, paper.conferenceId)) {
      notices.push({
        userId,
        submissionId: paper.id,
        message: toOrganiser.needsReviewers(ref, missing),
      });
    }
  }

  await queueNotices(tx, notices);
  return { assigned: chosen, missing };
}

/**
 * Matches reviewers to one paper. A paper still waiting for its first
 * reviewers moves to "under review" in the same transaction; if nobody at all
 * could be found it stays where it is, still editable by its submitter.
 */
export async function assignReviewers(submissionId: string, actor: Actor): Promise<FillResult> {
  let result: FillResult = { assigned: [], missing: 0 };
  try {
    await db.$transaction(async (tx) => {
      result = await fillReviewerPlaces(tx, submissionId, actor);
      if (result.assigned.length === 0) return;

      const paper = await tx.submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: { status: true },
      });
      if (paper.status === "SUBMITTED") {
        const moved = await transition({ submissionId, event: "start_review", actor, tx });
        if (!moved.ok) throw new RollBack(moved.reason);
      } else if (paper.status === "REVIEWS_COMPLETE") {
        const moved = await transition({ submissionId, event: "reopen_reviews", actor, tx });
        if (!moved.ok) throw new RollBack(moved.reason);
      }
    });
  } catch (error) {
    if (error instanceof RollBack) return { assigned: [], missing: 0 };
    throw error;
  }
  kickEmailDispatch();
  return result;
}

export type MatchingSummary = { papers: number; assigned: number; stillShort: number };

/**
 * Matches every paper in a conference that is waiting for reviewers or short
 * of them. Run by an organiser, or by the daily job once the call closes.
 */
export async function runMatching(conferenceId: string, actor: Actor): Promise<MatchingSummary> {
  const papers = await db.submission.findMany({
    where: { conferenceId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
    orderBy: { submittedAt: "asc" },
    select: { id: true },
  });

  const summary: MatchingSummary = { papers: papers.length, assigned: 0, stillShort: 0 };
  for (const paper of papers) {
    const result = await assignReviewers(paper.id, actor);
    summary.assigned += result.assigned.length;
    if (result.missing > 0) summary.stillShort += 1;
  }

  await db.conference.update({ where: { id: conferenceId }, data: { matchedAt: new Date() } });
  await db.activityLog.create({
    data: {
      action: "conference.matching_run",
      entityType: "Conference",
      entityId: conferenceId,
      actorId: actor.id,
      actorRole: actor.role === "SYSTEM" ? null : actor.role,
      metadata: summary,
    },
  });
  return summary;
}

/**
 * Decides what happens after a paper's reviews change — a review submitted,
 * a reviewer declining or being removed. Called inside that change's
 * transaction.
 *
 *   - Someone still has it to review: nothing yet.
 *   - The finished reviews disagree and no tie-breaker has been asked: one
 *     more reviewer is added.
 *   - Otherwise, if there is at least one finished review, the reviews are
 *     complete and the organisers are told it is ready for a decision.
 */
export async function settleReviews(
  tx: Prisma.TransactionClient,
  submissionId: string,
  actor: Actor,
): Promise<void> {
  const paper = await tx.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: {
      status: true,
      conference: { select: { reviewersPerPaper: true } },
      assignments: {
        select: {
          status: true,
          isTiebreaker: true,
          review: { select: { score: true, recommend: true, status: true } },
        },
      },
    },
  });
  if (paper.status !== "UNDER_REVIEW") return;

  const open = paper.assignments.filter(
    (assignment) => assignment.status === "PENDING" || assignment.status === "ACCEPTED",
  );
  if (open.length > 0) return;

  const finished = paper.assignments
    .filter((assignment) => assignment.status === "COMPLETED")
    .map((assignment) => assignment.review)
    .filter((review) => review?.status === "SUBMITTED")
    .map((review) => ({ score: review!.score ?? 0, recommend: review!.recommend ?? false }));
  if (finished.length === 0) return;

  const regular = paper.assignments.filter(
    (assignment) => assignment.status === "COMPLETED" && !assignment.isTiebreaker,
  ).length;
  // Short of reviewers because someone declined and nobody could replace
  // them: wait for the organiser to assign one, rather than deciding on less.
  if (regular < paper.conference.reviewersPerPaper) return;

  const hadTiebreaker = paper.assignments.some(
    (assignment) =>
      assignment.isTiebreaker && (LIVE_ASSIGNMENT as readonly string[]).includes(assignment.status),
  );
  if (!hadTiebreaker && needsTiebreaker(finished)) {
    // The system adds the tie-breaker, whoever submitted the last review.
    const added = await fillReviewerPlaces(tx, submissionId, SYSTEM_ACTOR, { tiebreaker: true });
    if (added.assigned.length > 0) return;
  }

  const moved = await transition({ submissionId, event: "complete_reviews", actor, tx });
  if (!moved.ok) throw new RollBack(moved.reason);
}
