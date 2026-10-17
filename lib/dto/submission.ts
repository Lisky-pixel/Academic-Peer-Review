import type { PaperType, SubmissionFormat } from "@/lib/generated/prisma/client";
import { EDITABLE, type OwnPaperRecord, type OwnReviewRecord } from "@/lib/submissions";
import { type SubmitterStage, submitterStage } from "@/lib/submissions/stage";
import { SUBMITTER_WITHDRAWABLE } from "@/lib/workflow/transitions";

/**
 * A paper as its submitter sees it.
 *
 * THE ANONYMITY BOUNDARY. These types have no reviewer field, no assignment
 * field and no internal status — only the submitter-facing `stage`. Because
 * the shape itself cannot carry a reviewer's identity, adding one by accident
 * is a compile error, not a leak. Do not add a field here without asking
 * whether it could identify who reviewed the work.
 */
export type UserPaperDTO = {
  id: string;
  reference: string;
  title: string;
  authorNames: string;
  contactEmail: string;
  institution: string;
  topic: string;
  /** The topic is one of the conference's own list (otherwise it was typed). */
  topicListed: boolean;
  disciplineId: string | null;
  discipline: string;
  disciplineOther: string | null;
  paperType: PaperType;
  abstract: string;
  stage: SubmitterStage;
  conference: {
    id: string;
    name: string;
    topics: string[];
    format: SubmissionFormat;
    closesAt: string;
    open: boolean;
  };
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  file: { filename: string; sizeBytes: number; uploadedAt: string } | null;
  /** Details and file can still be changed. */
  canEdit: boolean;
  /** Ready to submit: a draft, with a file if the conference needs one, while it is open. */
  canSubmit: boolean;
  canWithdraw: boolean;
};

export function toUserPaperDTO(record: OwnPaperRecord, now: Date = new Date()): UserPaperDTO {
  const file = record.files[0];
  const conference = record.conference;
  const open = conference.submissionsOpenAt <= now && now < conference.submissionsCloseAt;
  const needsFile = conference.submissionFormat === "FULL_PAPER";

  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    authorNames: record.authorNames,
    contactEmail: record.contactEmail,
    institution: record.institution,
    topic: record.topic,
    topicListed: conference.topics.includes(record.topic),
    disciplineId: record.disciplineId,
    discipline: record.discipline?.name ?? record.disciplineOther ?? "Other",
    disciplineOther: record.disciplineOther,
    paperType: record.paperType,
    abstract: record.abstract,
    stage: submitterStage(record.status),
    conference: {
      id: conference.id,
      name: conference.name,
      topics: conference.topics,
      format: conference.submissionFormat,
      closesAt: conference.submissionsCloseAt.toISOString(),
      open,
    },
    decisionNote: record.decisionNote,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
    file: file
      ? {
          filename: file.originalFilename,
          sizeBytes: file.sizeBytes,
          uploadedAt: file.createdAt.toISOString(),
        }
      : null,
    canEdit: EDITABLE.includes(record.status),
    canSubmit: record.status === "DRAFT" && open && (!needsFile || Boolean(file)),
    canWithdraw: SUBMITTER_WITHDRAWABLE.includes(record.status),
  };
}

/**
 * One review, as the paper's submitter reads it after the decision.
 * `reviewer` is a position ("Reviewer 2"), never a person.
 */
export type UserReviewDTO = {
  reviewer: string;
  score: number;
  recommend: boolean;
  comments: string;
  submittedAt: string | null;
  markedUpCopy: { fileId: string; filename: string; sizeBytes: number } | null;
};

export function toUserReviewDTOs(records: OwnReviewRecord[]): UserReviewDTO[] {
  return records.map((record, index) => {
    const file = record.files[0];
    return {
      reviewer: `Reviewer ${index + 1}`,
      score: record.score ?? 0,
      recommend: record.recommend ?? false,
      comments: record.comments ?? "",
      submittedAt: record.submittedAt?.toISOString() ?? null,
      markedUpCopy: file
        ? { fileId: file.id, filename: file.originalFilename, sizeBytes: file.sizeBytes }
        : null,
    };
  });
}
