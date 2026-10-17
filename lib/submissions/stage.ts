import type { SubmissionStatus } from "@/lib/generated/prisma/client";

/**
 * What a submitter is shown instead of the internal status.
 *
 * "Reviews complete" is the organisers' business: to the submitter the paper
 * is still under review until the decision is made, so the reviews arriving
 * one by one, a reviewer declining or a tie-breaker being added never shows
 * up as the paper appearing to move backwards or stall.
 */
export type SubmitterStage =
  "draft" | "submitted" | "under_review" | "accepted" | "rejected" | "withdrawn";

const STAGE: Record<SubmissionStatus, SubmitterStage> = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  REVIEWS_COMPLETE: "under_review",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
};

export function submitterStage(status: SubmissionStatus): SubmitterStage {
  return STAGE[status];
}

export type Tone = "neutral" | "progress" | "success" | "muted" | "warning";

export const STAGE_LABEL: Record<SubmitterStage, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  accepted: "Accepted",
  rejected: "Not accepted",
  withdrawn: "Withdrawn",
};

export const STAGE_TONE: Record<SubmitterStage, Tone> = {
  draft: "neutral",
  submitted: "progress",
  under_review: "progress",
  accepted: "success",
  rejected: "muted",
  withdrawn: "muted",
};

/** The steps of the progress track on a paper, in order. */
export const PROGRESS_STEPS: Array<{ stage: SubmitterStage; label: string }> = [
  { stage: "submitted", label: "Submitted" },
  { stage: "under_review", label: "Under review" },
  { stage: "accepted", label: "Decision" },
];

/** How many progress steps are complete or current, 0–3. */
export function progressOf(stage: SubmitterStage): number {
  if (stage === "accepted" || stage === "rejected") return PROGRESS_STEPS.length;
  return PROGRESS_STEPS.findIndex((step) => step.stage === stage) + 1;
}

/** Labels for the internal status, for organisers. */
export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for reviewers",
  UNDER_REVIEW: "Under review",
  REVIEWS_COMPLETE: "Ready for decision",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export const STATUS_TONE: Record<SubmissionStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "progress",
  UNDER_REVIEW: "progress",
  REVIEWS_COMPLETE: "warning",
  ACCEPTED: "success",
  REJECTED: "muted",
  WITHDRAWN: "muted",
};
