import { extensionOf } from "@/lib/files/validate";
import type { CriterionInputType, SubmissionStatus } from "@/lib/generated/prisma/client";
import type { QueueRecord, ReviewerSubmissionRecord, TemplateRecord } from "@/lib/reviews";

/**
 * What a reviewer is shown.
 *
 * THE OTHER ANONYMITY DIRECTION. Whether a reviewer may know who wrote a
 * submission is the per-submission `authorVisibleToReviewer` switch, and it
 * is resolved here and nowhere else: `resolveAuthorName()` returns the name
 * or null. Reviewer pages never see the record, only these DTOs, so there is
 * exactly one branch to get right. The author's email is never included in
 * either case.
 */

function resolveAuthorName(record: {
  authorVisibleToReviewer: boolean;
  author: { name: string };
}): string | null {
  return record.authorVisibleToReviewer ? record.author.name : null;
}

// ── Queue ──────────────────────────────────────────────────────────────────

export type QueueBucket = "pending" | "active" | "completed";

const BUCKET: Partial<Record<SubmissionStatus, QueueBucket>> = {
  ASSIGNED: "pending",
  ACCEPTED: "active",
  IN_REVIEW: "active",
  REVISION_REQUESTED: "active",
  UNDER_ADMIN_REVIEW: "completed",
  APPROVED: "completed",
  DELIVERED: "completed",
};

export type ReviewerQueueItemDTO = {
  submissionId: string;
  reference: string;
  title: string;
  documentType: string;
  authorName: string | null;
  bucket: QueueBucket;
  /** The admin sent the review back for changes. */
  revisionRequested: boolean;
  assignedAt: string;
  dueAt: string | null;
  /** Past its due date and not yet handed in. */
  overdue: boolean;
  submittedAt: string | null;
};

export function toReviewerQueueItemDTO(
  record: QueueRecord,
  now: Date = new Date(),
): ReviewerQueueItemDTO | null {
  const bucket = BUCKET[record.submission.status];
  if (!bucket) return null;

  return {
    submissionId: record.submission.id,
    reference: record.submission.reference,
    title: record.submission.title,
    documentType: record.submission.documentType.name,
    authorName: resolveAuthorName(record.submission),
    bucket,
    revisionRequested: record.submission.status === "REVISION_REQUESTED",
    assignedAt: record.assignedAt.toISOString(),
    dueAt: record.dueAt?.toISOString() ?? null,
    overdue: bucket !== "completed" && !!record.dueAt && record.dueAt.getTime() < now.getTime(),
    submittedAt: record.review?.submittedAt?.toISOString() ?? null,
  };
}

// ── Workspace ──────────────────────────────────────────────────────────────

export type CriterionDTO = {
  id: string;
  label: string;
  helpText: string | null;
  inputType: CriterionInputType;
  maxRating: number;
  required: boolean;
};

export type AnswerDTO = { rating: number | null; comment: string | null };

export type ReviewerSubmissionDTO = {
  id: string;
  reference: string;
  title: string;
  documentType: string;
  /** Null when the administrator has hidden the author from the reviewer. */
  authorName: string | null;
  purpose: string | null;
  description: string | null;
  instructions: string | null;
  focusAreas: string | null;
  dueAt: string | null;
  overdue: boolean;
  /**
   * invited   — assigned, waiting for the reviewer to accept or decline
   * working   — accepted; the review can be written
   * submitted — handed in; read-only
   */
  phase: "invited" | "working" | "submitted";
  /** The administrator's note when a review was sent back, if it was. */
  revisionNote: string | null;
  revisionRequested: boolean;
  /** The author's document. The name is the reference when the author is hidden. */
  document: { filename: string; sizeBytes: number } | null;
  /** The reviewer's own annotated copy, already scrubbed. */
  annotated: { filename: string; sizeBytes: number } | null;
  criteria: CriterionDTO[];
  answers: Record<string, AnswerDTO>;
  submittedAt: string | null;
};

const PHASE: Partial<Record<SubmissionStatus, ReviewerSubmissionDTO["phase"]>> = {
  ASSIGNED: "invited",
  ACCEPTED: "working",
  IN_REVIEW: "working",
  REVISION_REQUESTED: "working",
};

export function toReviewerSubmissionDTO(
  record: ReviewerSubmissionRecord,
  template: TemplateRecord | null,
  reviewerId: string,
  now: Date = new Date(),
): ReviewerSubmissionDTO {
  const assignment = record.assignments[0];
  const review = assignment?.review ?? null;
  const authorName = resolveAuthorName(record);
  const original = record.files.find((file) => file.kind === "ORIGINAL");
  const annotated = record.files.find(
    (file) => file.kind === "ANNOTATED" && file.uploadedById === reviewerId,
  );
  const phase = PHASE[record.status] ?? "submitted";
  const revisionRequested = record.status === "REVISION_REQUESTED";

  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    documentType: record.documentType.name,
    authorName,
    purpose: record.purpose,
    description: record.description,
    instructions: record.instructions,
    focusAreas: record.focusAreas,
    dueAt: assignment?.dueAt?.toISOString() ?? null,
    overdue:
      phase !== "submitted" && !!assignment?.dueAt && assignment.dueAt.getTime() < now.getTime(),
    phase,
    revisionNote: revisionRequested ? (review?.decisions[0]?.note ?? null) : null,
    revisionRequested,
    document: original
      ? {
          // An author's filename is very often their own name.
          filename: authorName
            ? original.originalFilename
            : `${record.reference}.${extensionOf(original.originalFilename)}`,
          sizeBytes: original.sizeBytes,
        }
      : null,
    annotated: annotated
      ? { filename: annotated.originalFilename, sizeBytes: annotated.sizeBytes }
      : null,
    criteria: (template?.criteria ?? []).map((criterion) => ({ ...criterion })),
    answers: Object.fromEntries(
      (review?.responses ?? []).map((response) => [
        response.criterionId,
        { rating: response.rating, comment: response.comment },
      ]),
    ),
    submittedAt: review?.submittedAt?.toISOString() ?? null,
  };
}
