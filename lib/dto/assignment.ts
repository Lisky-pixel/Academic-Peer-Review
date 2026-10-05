import type {
  ActivityRecord,
  AdminSubmissionDetailRecord,
  ReviewerWorkloadRecord,
} from "@/lib/assignments";
import type { AssignmentStatus, Role, SubmissionStatus } from "@/lib/generated/prisma/client";

/**
 * Administrator-only views. These carry reviewer identity in full, which is
 * exactly why they must never be passed to an author-facing page — those use
 * `toUserSubmissionDTO()`, whose type cannot hold a reviewer.
 */

export type ReviewerOptionDTO = {
  id: string;
  name: string;
  email: string;
  bio: string | null;
  /** Documents currently with this reviewer. */
  activeCount: number;
  /** How many of those are past their due date. */
  overdueCount: number;
};

export function toReviewerOptionDTO(record: ReviewerWorkloadRecord): ReviewerOptionDTO {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    bio: record.bio,
    activeCount: record.activeCount,
    overdueCount: record.overdueCount,
  };
}

export type AssignmentDTO = {
  id: string;
  reviewer: { id: string; name: string; email: string };
  assignedByName: string;
  status: AssignmentStatus;
  isCurrent: boolean;
  assignedAt: string;
  dueAt: string | null;
  /** When it stopped being live: declined, withdrawn or completed. */
  endedAt: string | null;
  declineReason: string | null;
  overdue: boolean;
};

export type AdminSubmissionDetailDTO = {
  id: string;
  reference: string;
  title: string;
  documentType: { id: string; name: string };
  status: SubmissionStatus;
  author: { id: string; name: string; email: string };
  purpose: string | null;
  description: string | null;
  instructions: string | null;
  focusAreas: string | null;
  deadline: string | null;
  submittedAt: string | null;
  authorVisibleToReviewer: boolean;
  document: { filename: string; sizeBytes: number } | null;
  /** The live assignment, if a reviewer currently holds this. */
  assignment: AssignmentDTO | null;
  /** Every assignment there has been, newest first, including the live one. */
  history: AssignmentDTO[];
  canAssign: boolean;
  canReassign: boolean;
  canChangeVisibility: boolean;
};

const REASSIGNABLE: SubmissionStatus[] = ["ASSIGNED", "ACCEPTED", "IN_REVIEW"];

export function toAdminSubmissionDetailDTO(
  record: AdminSubmissionDetailRecord,
  now: Date = new Date(),
): AdminSubmissionDetailDTO {
  const history: AssignmentDTO[] = record.assignments.map((assignment) => {
    const isCurrent = assignment.isActive === true;
    const ended = assignment.declinedAt ?? assignment.cancelledAt ?? assignment.completedAt;
    return {
      id: assignment.id,
      reviewer: { ...assignment.reviewer },
      assignedByName: assignment.assignedBy.name,
      status: assignment.status,
      isCurrent,
      assignedAt: assignment.assignedAt.toISOString(),
      dueAt: assignment.dueAt?.toISOString() ?? null,
      endedAt: ended?.toISOString() ?? null,
      declineReason: assignment.declineReason,
      overdue: isCurrent && !!assignment.dueAt && assignment.dueAt.getTime() < now.getTime(),
    };
  });
  const file = record.files[0];

  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    documentType: { ...record.documentType },
    status: record.status,
    author: { ...record.author },
    purpose: record.purpose,
    description: record.description,
    instructions: record.instructions,
    focusAreas: record.focusAreas,
    deadline: record.deadline?.toISOString() ?? null,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    authorVisibleToReviewer: record.authorVisibleToReviewer,
    document: file ? { filename: file.originalFilename, sizeBytes: file.sizeBytes } : null,
    assignment: history.find((assignment) => assignment.isCurrent) ?? null,
    history,
    canAssign: record.status === "PENDING_ASSIGNMENT",
    canReassign: REASSIGNABLE.includes(record.status),
    canChangeVisibility: !["DELIVERED", "CANCELLED"].includes(record.status),
  };
}

const ACTION_LABEL: Record<string, string> = {
  "submission.create_draft": "Draft started",
  "submission.submit": "Submitted for review",
  "submission.assign": "Reviewer assigned",
  "submission.reassign": "Reassigned to another reviewer",
  "submission.accept": "Reviewer accepted",
  "submission.decline": "Reviewer declined",
  "submission.start_review": "Review started",
  "submission.submit_review": "Review submitted",
  "submission.request_revision": "Revision requested",
  "submission.resubmit_review": "Revised review submitted",
  "submission.approve": "Review approved",
  "submission.deliver": "Delivered to the author",
  "submission.cancel": "Cancelled",
  "submission.author_visibility": "Author visibility changed",
};

const ROLE_LABEL: Record<Role, string> = {
  USER: "Author",
  REVIEWER: "Reviewer",
  ADMIN: "Administrator",
};

export type ActivityDTO = {
  id: string;
  label: string;
  /** Who did it, named in full — this is the administrator's audit trail. */
  actor: string;
  at: string;
  /** A reason or setting recorded with the event, if any. */
  detail: string | null;
};

export function toActivityDTO(record: ActivityRecord): ActivityDTO {
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};

  let detail: string | null = null;
  if (typeof metadata.reason === "string") detail = metadata.reason;
  else if (typeof metadata.authorVisibleToReviewer === "boolean") {
    detail = metadata.authorVisibleToReviewer
      ? "The reviewer can now see who the author is."
      : "The author is now hidden from the reviewer.";
  }

  return {
    id: record.id,
    label: ACTION_LABEL[record.action] ?? record.action,
    actor: record.actor
      ? `${record.actor.name}${record.actorRole ? ` (${ROLE_LABEL[record.actorRole]})` : ""}`
      : "System",
    at: record.createdAt.toISOString(),
    detail,
  };
}
