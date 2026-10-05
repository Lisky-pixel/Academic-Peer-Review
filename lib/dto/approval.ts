import { type AdminReviewRecord, annotatedFileOf, type OwnReviewRecord } from "@/lib/approvals";
import type { AdminDecisionType, CriterionInputType } from "@/lib/generated/prisma/client";

type AnsweredCriterion = {
  id: string;
  label: string;
  helpText: string | null;
  inputType: CriterionInputType;
  maxRating: number;
  rating: number | null;
  comment: string | null;
};

function answered(
  criteria: Array<Omit<AnsweredCriterion, "rating" | "comment">>,
  responses: Array<{ criterionId: string; rating: number | null; comment: string | null }>,
): AnsweredCriterion[] {
  const byCriterion = new Map(responses.map((response) => [response.criterionId, response]));
  return criteria.map((criterion) => ({
    ...criterion,
    rating: byCriterion.get(criterion.id)?.rating ?? null,
    comment: byCriterion.get(criterion.id)?.comment ?? null,
  }));
}

// ── Administrator ──────────────────────────────────────────────────────────

/**
 * A submitted review as the administrator reads it. Names the reviewer, so it
 * is for admin pages only.
 */
export type AdminReviewDTO = {
  reviewerName: string;
  /** How many times it has been sent back. */
  round: number;
  submittedAt: string | null;
  criteria: AnsweredCriterion[];
  original: { filename: string; sizeBytes: number } | null;
  annotated: { filename: string; sizeBytes: number } | null;
  /** Every decision so far, newest first. */
  decisions: Array<{
    id: string;
    decision: AdminDecisionType;
    note: string | null;
    adminName: string;
    at: string;
  }>;
  /** It is waiting for the administrator right now. */
  awaitingDecision: boolean;
};

export function toAdminReviewDTO(record: AdminReviewRecord): AdminReviewDTO | null {
  const assignment = record.assignments[0];
  const review = assignment?.review;
  if (!assignment || !review) return null;

  const original = record.files.find((file) => file.kind === "ORIGINAL");
  const annotated = annotatedFileOf(record);

  return {
    reviewerName: assignment.reviewer.name,
    round: review.revisionRound,
    submittedAt: review.submittedAt?.toISOString() ?? null,
    criteria: answered(review.template.criteria, review.responses),
    original: original
      ? { filename: original.originalFilename, sizeBytes: original.sizeBytes }
      : null,
    annotated: annotated
      ? { filename: annotated.originalFilename, sizeBytes: annotated.sizeBytes }
      : null,
    decisions: review.decisions.map((decision) => ({
      id: decision.id,
      decision: decision.decision,
      note: decision.note,
      adminName: decision.admin.name,
      at: decision.createdAt.toISOString(),
    })),
    awaitingDecision: record.status === "UNDER_ADMIN_REVIEW",
  };
}

// ── Author ─────────────────────────────────────────────────────────────────

/**
 * The approved review as its author reads it.
 *
 * THE ANONYMITY BOUNDARY, again. There is no field here that can hold a
 * reviewer's name, email or id: `reviewer` is the literal string "Anonymous"
 * and nothing else. The administrator's notes to the reviewer are not here
 * either — those are internal. Do not add a field without asking whether it
 * could identify who wrote the review.
 */
export type UserReviewDTO = {
  reviewer: "Anonymous";
  approvedAt: string | null;
  criteria: Array<{
    label: string;
    maxRating: number;
    rating: number | null;
    comment: string | null;
  }>;
  /** The annotated copy, already scrubbed of the reviewer's identity. */
  reviewedFile: { filename: string; sizeBytes: number } | null;
};

export function toUserReviewDTO(record: OwnReviewRecord): UserReviewDTO | null {
  const review = record.assignments[0]?.review;
  if (!review) return null;

  const file = annotatedFileOf(record);

  return {
    reviewer: "Anonymous",
    approvedAt: record.approvedAt?.toISOString() ?? null,
    criteria: answered(review.template.criteria, review.responses)
      // An optional criterion the reviewer skipped has nothing to show.
      .filter((criterion) => criterion.rating !== null || criterion.comment)
      .map((criterion) => ({
        label: criterion.label,
        maxRating: criterion.maxRating,
        rating: criterion.rating,
        comment: criterion.comment,
      })),
    reviewedFile: file ? { filename: file.originalFilename, sizeBytes: file.sizeBytes } : null,
  };
}
