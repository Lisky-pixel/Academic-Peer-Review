import { extensionOf } from "@/lib/files/validate";
import type { PaperType, SubmissionFormat } from "@/lib/generated/prisma/client";
import type { QueueRecord, ReviewerPaperRecord } from "@/lib/reviews";

/**
 * What a reviewer is shown.
 *
 * THE OTHER ANONYMITY DIRECTION. Whether a reviewer may know who wrote a
 * paper is the conference's `doubleBlind` setting, and it is resolved here
 * and nowhere else. Reviewer pages never see the record, only these DTOs, so
 * there is exactly one branch to get right. The submitter's email is never
 * included either way.
 */

// ── Queue ──────────────────────────────────────────────────────────────────

export type QueueBucket = "pending" | "active" | "completed";

export type ReviewerQueueItemDTO = {
  submissionId: string;
  reference: string;
  title: string;
  conferenceName: string;
  topic: string;
  paperType: PaperType;
  bucket: QueueBucket;
  assignedAt: string;
  dueAt: string;
  overdue: boolean;
  /** Set once the review is submitted. */
  score: number | null;
  recommend: boolean | null;
  /** The paper has been decided or the review is in: nothing left to do. */
  closed: boolean;
};

export function toReviewerQueueItemDTO(
  record: QueueRecord,
  now: Date = new Date(),
): ReviewerQueueItemDTO {
  const bucket: QueueBucket =
    record.status === "COMPLETED"
      ? "completed"
      : record.status === "PENDING"
        ? "pending"
        : "active";
  const submitted = record.review?.status === "SUBMITTED";
  return {
    submissionId: record.submission.id,
    reference: record.submission.reference,
    title: record.submission.title,
    conferenceName: record.submission.conference.name,
    topic: record.submission.topic,
    paperType: record.submission.paperType,
    bucket,
    assignedAt: record.assignedAt.toISOString(),
    dueAt: record.dueAt.toISOString(),
    overdue: bucket !== "completed" && record.dueAt < now,
    score: submitted ? (record.review?.score ?? null) : null,
    recommend: submitted ? (record.review?.recommend ?? null) : null,
    closed: bucket === "completed" || record.submission.status !== "UNDER_REVIEW",
  };
}

// ── One paper ──────────────────────────────────────────────────────────────

export type ReviewerPaperDTO = {
  id: string;
  reference: string;
  title: string;
  conferenceName: string;
  doubleBlind: boolean;
  format: SubmissionFormat;
  topic: string;
  discipline: string;
  paperType: PaperType;
  abstract: string;
  /** Null when the conference is double-blind. */
  authorNames: string | null;
  institution: string | null;
  /** The paper, named by its reference when the conference is double-blind. */
  file: { filename: string; sizeBytes: number } | null;
  assignment: {
    status: "PENDING" | "ACCEPTED" | "COMPLETED";
    dueAt: string;
    assignedAt: string;
    isTiebreaker: boolean;
  };
  review: {
    score: number | null;
    recommend: boolean | null;
    comments: string;
    submitted: boolean;
    submittedAt: string | null;
    markedUpCopy: { filename: string; sizeBytes: number } | null;
  } | null;
  /** The review can still be written: the paper is under review and it is not sent. */
  canWrite: boolean;
};

export function toReviewerPaperDTO(record: ReviewerPaperRecord): ReviewerPaperDTO | null {
  const assignment = record.assignments[0];
  if (!assignment) return null;
  const blind = record.conference.doubleBlind;
  const file = record.files[0];
  const review = assignment.review;
  const copy = review?.files[0];

  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    conferenceName: record.conference.name,
    doubleBlind: blind,
    format: record.conference.submissionFormat,
    topic: record.topic,
    discipline: record.discipline?.name ?? record.disciplineOther ?? "Other",
    paperType: record.paperType,
    abstract: record.abstract,
    authorNames: blind ? null : record.authorNames,
    institution: blind ? null : record.institution,
    file: file
      ? {
          filename: blind
            ? `${record.reference}.${extensionOf(file.originalFilename)}`
            : file.originalFilename,
          sizeBytes: file.sizeBytes,
        }
      : null,
    assignment: {
      status: assignment.status as "PENDING" | "ACCEPTED" | "COMPLETED",
      dueAt: assignment.dueAt.toISOString(),
      assignedAt: assignment.assignedAt.toISOString(),
      isTiebreaker: assignment.isTiebreaker,
    },
    review: review
      ? {
          score: review.score,
          recommend: review.recommend,
          comments: review.comments ?? "",
          submitted: review.status === "SUBMITTED",
          submittedAt: review.submittedAt?.toISOString() ?? null,
          markedUpCopy:
            copy && copy.scrubbedAt
              ? { filename: copy.originalFilename, sizeBytes: copy.sizeBytes }
              : null,
        }
      : null,
    canWrite:
      record.status === "UNDER_REVIEW" &&
      assignment.status !== "COMPLETED" &&
      review?.status !== "SUBMITTED",
  };
}
