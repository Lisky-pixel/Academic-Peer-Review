import type { Role, SubmissionStatus } from "@/lib/generated/prisma/client";

/**
 * The submission lifecycle as data.
 *
 * This file is the single definition of which moves are legal and who may
 * make them. It is pure — no database — so every cell of the table can be
 * tested directly. `state-machine.ts` applies a transition; nothing else in
 * the codebase may assign `Submission.status`.
 */

export type WorkflowEvent =
  | "submit"
  | "assign"
  | "accept"
  | "decline"
  | "reassign"
  | "start_review"
  | "submit_review"
  | "request_revision"
  | "resubmit_review"
  | "approve"
  | "deliver"
  | "cancel";

/** Who is acting. "SYSTEM" is the application itself, e.g. first-view delivery. */
export type ActorRole = Role | "SYSTEM";

type Rule = {
  from: SubmissionStatus[];
  to: SubmissionStatus;
  by: ActorRole[];
};

export const TERMINAL_STATUSES: SubmissionStatus[] = ["DELIVERED", "CANCELLED"];

/** States an author may still withdraw from: nobody has been asked to read it. */
export const AUTHOR_CANCELLABLE: SubmissionStatus[] = ["DRAFT", "PENDING_ASSIGNMENT"];

const NON_TERMINAL: SubmissionStatus[] = [
  "DRAFT",
  "PENDING_ASSIGNMENT",
  "ASSIGNED",
  "ACCEPTED",
  "IN_REVIEW",
  "UNDER_ADMIN_REVIEW",
  "REVISION_REQUESTED",
  "APPROVED",
];

export const TRANSITIONS: Record<WorkflowEvent, Rule> = {
  submit: { from: ["DRAFT"], to: "PENDING_ASSIGNMENT", by: ["USER"] },
  assign: { from: ["PENDING_ASSIGNMENT"], to: "ASSIGNED", by: ["ADMIN"] },
  accept: { from: ["ASSIGNED"], to: "ACCEPTED", by: ["REVIEWER"] },
  decline: { from: ["ASSIGNED"], to: "PENDING_ASSIGNMENT", by: ["REVIEWER"] },
  reassign: { from: ["ASSIGNED", "ACCEPTED", "IN_REVIEW"], to: "ASSIGNED", by: ["ADMIN"] },
  start_review: { from: ["ACCEPTED"], to: "IN_REVIEW", by: ["REVIEWER"] },
  submit_review: { from: ["IN_REVIEW"], to: "UNDER_ADMIN_REVIEW", by: ["REVIEWER"] },
  request_revision: { from: ["UNDER_ADMIN_REVIEW"], to: "REVISION_REQUESTED", by: ["ADMIN"] },
  resubmit_review: { from: ["REVISION_REQUESTED"], to: "UNDER_ADMIN_REVIEW", by: ["REVIEWER"] },
  approve: { from: ["UNDER_ADMIN_REVIEW"], to: "APPROVED", by: ["ADMIN"] },
  deliver: { from: ["APPROVED"], to: "DELIVERED", by: ["SYSTEM"] },
  cancel: { from: NON_TERMINAL, to: "CANCELLED", by: ["ADMIN", "USER"] },
};

export type TransitionDenial = "illegal_from_this_status" | "role_not_allowed";

export type TransitionDecision =
  { ok: true; to: SubmissionStatus } | { ok: false; reason: TransitionDenial };

/**
 * Decides whether `role` may apply `event` to a submission in status `from`.
 * Says nothing about *which* user — ownership is checked by the state machine,
 * which knows the submission.
 */
export function decideTransition(
  from: SubmissionStatus,
  event: WorkflowEvent,
  role: ActorRole,
): TransitionDecision {
  const rule = TRANSITIONS[event];
  if (!rule.from.includes(from)) return { ok: false, reason: "illegal_from_this_status" };
  if (!rule.by.includes(role)) return { ok: false, reason: "role_not_allowed" };
  // An author may only withdraw before anyone has been asked to read it.
  if (event === "cancel" && role === "USER" && !AUTHOR_CANCELLABLE.includes(from)) {
    return { ok: false, reason: "role_not_allowed" };
  }
  return { ok: true, to: rule.to };
}
