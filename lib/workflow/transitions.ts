import type { SubmissionStatus } from "@/lib/generated/prisma/client";

/**
 * The paper lifecycle as data.
 *
 * This file is the single definition of which moves are legal and in what
 * capacity someone may make them. It is pure — no database — so every cell
 * of the table can be tested directly. `state-machine.ts` applies a
 * transition; nothing else in the codebase may assign `Submission.status`.
 *
 * A capacity is a relationship to the paper, not a role: a reviewer who
 * submitted a paper acts on it as its SUBMITTER, and an administrator acts
 * on any conference as its ORGANISER. The state machine works out which
 * capacities the person actually has.
 */

export type WorkflowEvent =
  | "submit"
  | "start_review"
  | "complete_reviews"
  | "reopen_reviews"
  | "accept"
  | "reject"
  | "withdraw";

export type Capacity = "SUBMITTER" | "ORGANISER" | "REVIEWER" | "SYSTEM";

type Rule = {
  from: SubmissionStatus[];
  to: SubmissionStatus;
  by: Capacity[];
};

export const TERMINAL_STATUSES: SubmissionStatus[] = ["ACCEPTED", "REJECTED", "WITHDRAWN"];

/** States a submitter may still withdraw from: no reviewer has it yet. */
export const SUBMITTER_WITHDRAWABLE: SubmissionStatus[] = ["DRAFT", "SUBMITTED"];

/** States a decision can be made from. A decision ends any review still open. */
export const DECIDABLE: SubmissionStatus[] = ["UNDER_REVIEW", "REVIEWS_COMPLETE"];

export const TRANSITIONS: Record<WorkflowEvent, Rule> = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", by: ["SUBMITTER"] },
  // The first reviewers are assigned, by the organiser or automatically.
  start_review: { from: ["SUBMITTED"], to: "UNDER_REVIEW", by: ["ORGANISER", "SYSTEM"] },
  // The last review came in; the reviewer who sent it triggers this.
  complete_reviews: {
    from: ["UNDER_REVIEW"],
    to: "REVIEWS_COMPLETE",
    by: ["REVIEWER", "ORGANISER", "SYSTEM"],
  },
  // Another reviewer was added after the reviews were complete.
  reopen_reviews: { from: ["REVIEWS_COMPLETE"], to: "UNDER_REVIEW", by: ["ORGANISER", "SYSTEM"] },
  accept: { from: DECIDABLE, to: "ACCEPTED", by: ["ORGANISER"] },
  reject: { from: DECIDABLE, to: "REJECTED", by: ["ORGANISER"] },
  withdraw: {
    from: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REVIEWS_COMPLETE"],
    to: "WITHDRAWN",
    by: ["SUBMITTER", "ORGANISER"],
  },
};

export type TransitionDenial = "illegal_from_this_status" | "not_allowed";

export type TransitionDecision =
  { ok: true; to: SubmissionStatus; as: Capacity } | { ok: false; reason: TransitionDenial };

/**
 * Decides whether someone holding `capacities` may apply `event` to a paper
 * in status `from`, and in which capacity they act.
 */
export function decideTransition(
  from: SubmissionStatus,
  event: WorkflowEvent,
  capacities: Capacity[],
): TransitionDecision {
  const rule = TRANSITIONS[event];
  if (!rule.from.includes(from)) return { ok: false, reason: "illegal_from_this_status" };

  // The organiser is preferred where both apply: an organiser withdrawing a
  // paper they also submitted is acting as the organiser.
  const as = (["ORGANISER", "SYSTEM", "REVIEWER", "SUBMITTER"] as const).find(
    (capacity) => rule.by.includes(capacity) && capacities.includes(capacity),
  );
  if (!as) return { ok: false, reason: "not_allowed" };

  // A submitter may withdraw only before a reviewer has the paper.
  if (event === "withdraw" && as === "SUBMITTER" && !SUBMITTER_WITHDRAWABLE.includes(from)) {
    return { ok: false, reason: "not_allowed" };
  }
  return { ok: true, to: rule.to, as };
}
