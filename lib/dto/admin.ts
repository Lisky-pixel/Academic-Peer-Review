import type { ActivityLogRecord } from "@/lib/admin/activity";
import type { AdminUserRecord } from "@/lib/admin/users";
import type { Role, UserStatus } from "@/lib/generated/prisma/client";

/** Administrator-only views of people and the audit log. */

// ── People ─────────────────────────────────────────────────────────────────

export type AdminUserDTO = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  joinedAt: string;
  lastSeenAt: string | null;
  submissions: number;
  /** Reviews currently in this person's hands (reviewers only). */
  openReviews: number;
};

export function toAdminUserDTO(record: AdminUserRecord): AdminUserDTO {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    status: record.status,
    joinedAt: record.createdAt.toISOString(),
    lastSeenAt: record.sessions[0]?.lastUsedAt.toISOString() ?? null,
    submissions: record._count.submissions,
    openReviews: record.assignmentsToReview.length,
  };
}

export const ROLE_LABEL: Record<Role, string> = {
  USER: "Submitter",
  REVIEWER: "Reviewer",
  ORGANISER: "Organiser",
  ADMIN: "Administrator",
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  UNVERIFIED: "Unconfirmed",
  SUSPENDED: "Suspended",
};

// ── Activity ───────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  "submission.create_draft": "Draft started",
  "submission.edited": "Paper edited",
  "submission.submit": "Paper submitted",
  "submission.start_review": "Sent to reviewers",
  "submission.complete_reviews": "Reviews complete",
  "submission.reopen_reviews": "Reviews reopened",
  "submission.accept": "Paper accepted",
  "submission.reject": "Paper rejected",
  "submission.withdraw": "Paper withdrawn",
  "assignment.created": "Reviewer assigned",
  "assignment.accepted": "Reviewer accepted",
  "assignment.declined": "Reviewer declined",
  "assignment.conflict_declared": "Reviewer declared a conflict",
  "assignment.cancelled": "Reviewer removed",
  "review.submitted": "Review submitted",
  "conference.created": "Conference created",
  "conference.updated": "Conference settings changed",
  "conference.organiser_added": "Organiser added",
  "conference.organiser_removed": "Organiser removed",
  "conference.payment_recorded": "Payment recorded",
  "conference.matching_run": "Reviewers matched",
  "auth.login": "Signed in",
  "auth.registered": "Account confirmed",
  "auth.password_reset": "Password reset by email",
  "auth.password_changed": "Password changed",
  "auth.invite_sent": "Invitation sent",
  "auth.invite_cancelled": "Invitation cancelled",
  "auth.invite_accepted": "Invitation accepted",
  "user.suspended": "Account suspended",
  "user.reactivated": "Account reactivated",
  "user.became_reviewer": "Became a reviewer",
};

/** A readable name for a logged action; the raw name if it is a new one. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export type ActivityEntryDTO = {
  id: string;
  label: string;
  /** Who did it, named in full: this is the audit trail. */
  actor: string;
  /** What it was done to: a reference, a person, a conference. */
  subject: string | null;
  /** Where to read more, when the subject has a page. */
  href: string | null;
  detail: string | null;
  at: string;
};

export function toActivityEntryDTO(record: ActivityLogRecord): ActivityEntryDTO {
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};

  let detail: string | null = null;
  if (typeof metadata.reason === "string") detail = metadata.reason;
  else if (typeof metadata.note === "string") detail = metadata.note;
  else if (typeof metadata.receiptNumber === "string") detail = `Receipt ${metadata.receiptNumber}`;
  else if (typeof metadata.assigned === "number") {
    detail = `${metadata.assigned} reviewer places filled across ${metadata.papers} papers`;
  } else if (metadata.tiebreaker === true) detail = "Added as a tie-breaker";
  else if (metadata.automatic === true) detail = "Matched automatically";

  const href = record.href;

  return {
    id: record.id,
    label: actionLabel(record.action),
    actor: record.actor
      ? `${record.actor.name}${record.actorRole ? ` (${ROLE_LABEL[record.actorRole]})` : ""}`
      : "System",
    subject: record.subject,
    href,
    detail,
    at: record.createdAt.toISOString(),
  };
}
