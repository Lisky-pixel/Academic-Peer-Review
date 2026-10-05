import type { SubmissionStatus } from "@/lib/generated/prisma/client";

/**
 * What an author is shown instead of the internal status.
 *
 * The twelve workflow states describe the operation — who accepted what, and
 * whether a review was sent back for changes. An author needs a simpler and
 * steadier story: where their document is, and whether anything is ready.
 * Collapsing here also means internal back-and-forth (a reviewer declining,
 * an admin asking for a revision) never shows up as the author's submission
 * appearing to go backwards.
 */
export type AuthorStage =
  | "draft"
  | "awaiting_reviewer"
  | "with_reviewer"
  | "in_review"
  | "final_checks"
  | "ready"
  | "completed"
  | "cancelled";

const STAGE: Record<SubmissionStatus, AuthorStage> = {
  DRAFT: "draft",
  SUBMITTED: "awaiting_reviewer",
  PENDING_ASSIGNMENT: "awaiting_reviewer",
  ASSIGNED: "with_reviewer",
  ACCEPTED: "with_reviewer",
  IN_REVIEW: "in_review",
  REVIEW_SUBMITTED: "final_checks",
  UNDER_ADMIN_REVIEW: "final_checks",
  REVISION_REQUESTED: "final_checks",
  APPROVED: "ready",
  DELIVERED: "completed",
  CANCELLED: "cancelled",
};

export function authorStage(status: SubmissionStatus): AuthorStage {
  return STAGE[status];
}

export type Tone = "neutral" | "progress" | "success" | "muted";

export const STAGE_LABEL: Record<AuthorStage, string> = {
  draft: "Draft",
  awaiting_reviewer: "Awaiting a reviewer",
  with_reviewer: "Reviewer assigned",
  in_review: "In review",
  final_checks: "Final checks",
  ready: "Ready to read",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STAGE_TONE: Record<AuthorStage, Tone> = {
  draft: "neutral",
  awaiting_reviewer: "progress",
  with_reviewer: "progress",
  in_review: "progress",
  final_checks: "progress",
  ready: "success",
  completed: "success",
  cancelled: "muted",
};

/** The steps of the progress track on a submission, in order. */
export const PROGRESS_STEPS: Array<{ stage: AuthorStage; label: string }> = [
  { stage: "awaiting_reviewer", label: "Submitted" },
  { stage: "with_reviewer", label: "Reviewer assigned" },
  { stage: "in_review", label: "In review" },
  { stage: "final_checks", label: "Final checks" },
  { stage: "ready", label: "Ready" },
];

/**
 * How many progress steps are complete or current, 0–5. A completed
 * submission has passed every step; drafts and cancellations have none.
 */
export function progressOf(stage: AuthorStage): number {
  if (stage === "completed") return PROGRESS_STEPS.length;
  return PROGRESS_STEPS.findIndex((step) => step.stage === stage) + 1;
}

/** Labels for the internal status, for administrators. */
export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PENDING_ASSIGNMENT: "Needs a reviewer",
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  IN_REVIEW: "In review",
  REVIEW_SUBMITTED: "Review submitted",
  UNDER_ADMIN_REVIEW: "Needs approval",
  REVISION_REQUESTED: "Revision requested",
  APPROVED: "Approved",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const STATUS_TONE: Record<SubmissionStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "progress",
  PENDING_ASSIGNMENT: "progress",
  ASSIGNED: "progress",
  ACCEPTED: "progress",
  IN_REVIEW: "progress",
  REVIEW_SUBMITTED: "progress",
  UNDER_ADMIN_REVIEW: "progress",
  REVISION_REQUESTED: "progress",
  APPROVED: "success",
  DELIVERED: "success",
  CANCELLED: "muted",
};
