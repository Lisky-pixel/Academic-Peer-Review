import type {
  ConferenceDetailRecord,
  ConferenceListRecord,
  PaperDetailRecord,
  PaperRowRecord,
} from "@/lib/conferences";
import type {
  AssignmentStatus,
  PaperType,
  SubmissionFormat,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

/**
 * Conferences and papers as organisers and administrators see them.
 *
 * ORGANISERS ONLY. These carry reviewer names and the submitter's details,
 * and must never reach a submitter's page or a reviewer's page.
 */

export type ConferencePhase = "upcoming" | "open" | "reviewing" | "finished";

export function phaseOf(
  conference: { submissionsOpenAt: Date; submissionsCloseAt: Date; reviewDeadline: Date },
  now: Date = new Date(),
): ConferencePhase {
  if (now < conference.submissionsOpenAt) return "upcoming";
  if (now < conference.submissionsCloseAt) return "open";
  if (now < conference.reviewDeadline) return "reviewing";
  return "finished";
}

export const PHASE_LABEL: Record<ConferencePhase, string> = {
  upcoming: "Opens soon",
  open: "Open for papers",
  reviewing: "In review",
  finished: "Reviews due date passed",
};

export type ConferenceListDTO = {
  id: string;
  name: string;
  venue: string | null;
  startsOn: string | null;
  endsOn: string | null;
  opensAt: string;
  closesAt: string;
  reviewDeadline: string;
  phase: ConferencePhase;
  packageName: string | null;
  submissionLimit: number | null;
  papers: number;
  organisers: Array<{ id: string; name: string; email: string }>;
};

export function toConferenceListDTO(
  record: ConferenceListRecord,
  now: Date = new Date(),
): ConferenceListDTO {
  return {
    id: record.id,
    name: record.name,
    venue: record.venue,
    startsOn: record.startsOn?.toISOString() ?? null,
    endsOn: record.endsOn?.toISOString() ?? null,
    opensAt: record.submissionsOpenAt.toISOString(),
    closesAt: record.submissionsCloseAt.toISOString(),
    reviewDeadline: record.reviewDeadline.toISOString(),
    phase: phaseOf(record, now),
    packageName: record.packageName,
    submissionLimit: record.submissionLimit,
    papers: record._count.submissions,
    organisers: record.organisers.map((row) => row.user),
  };
}

export type ConferenceDetailDTO = ConferenceListDTO & {
  description: string | null;
  reviewersPerPaper: number;
  maxPapersPerReviewer: number;
  doubleBlind: boolean;
  format: SubmissionFormat;
  topics: string[];
  matchedAt: string | null;
  payments: Array<{
    id: string;
    amountMinor: number;
    currency: string;
    description: string;
    reference: string | null;
    paidAt: string;
    receiptNumber: string;
    receiptSentAt: string | null;
    recordedBy: string;
  }>;
};

export function toConferenceDetailDTO(
  record: ConferenceDetailRecord,
  now: Date = new Date(),
): ConferenceDetailDTO {
  return {
    ...toConferenceListDTO(record, now),
    description: record.description,
    reviewersPerPaper: record.reviewersPerPaper,
    maxPapersPerReviewer: record.maxPapersPerReviewer,
    doubleBlind: record.doubleBlind,
    format: record.submissionFormat,
    topics: record.topics,
    matchedAt: record.matchedAt?.toISOString() ?? null,
    payments: record.payments.map((payment) => ({
      id: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description: payment.description,
      reference: payment.reference,
      paidAt: payment.paidAt.toISOString(),
      receiptNumber: payment.receiptNumber,
      receiptSentAt: payment.receiptSentAt?.toISOString() ?? null,
      recordedBy: payment.recordedBy.name,
    })),
  };
}

// ── Papers ─────────────────────────────────────────────────────────────────

function average(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
}

export type PaperRowDTO = {
  id: string;
  reference: string;
  title: string;
  authorNames: string;
  institution: string;
  topic: string;
  discipline: string;
  paperType: PaperType;
  status: SubmissionStatus;
  submittedAt: string | null;
  reviewers: number;
  reviewsIn: number;
  averageScore: number | null;
  recommended: number;
  overdue: number;
};

export function toPaperRowDTO(record: PaperRowRecord, now: Date = new Date()): PaperRowDTO {
  const finished = record.assignments
    .map((assignment) => assignment.review)
    .filter((review) => review?.status === "SUBMITTED");
  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    authorNames: record.authorNames,
    institution: record.institution,
    topic: record.topic,
    discipline: record.discipline?.name ?? record.disciplineOther ?? "Other",
    paperType: record.paperType,
    status: record.status,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    reviewers: record.assignments.length,
    reviewsIn: finished.length,
    averageScore: average(finished.map((review) => review?.score ?? 0).filter(Boolean)),
    recommended: finished.filter((review) => review?.recommend).length,
    overdue: record.assignments.filter(
      (assignment) =>
        (assignment.status === "PENDING" || assignment.status === "ACCEPTED") &&
        assignment.dueAt < now,
    ).length,
  };
}

export type PaperAssignmentDTO = {
  id: string;
  status: AssignmentStatus;
  isTiebreaker: boolean;
  dueAt: string;
  assignedAt: string;
  completedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  conflictDeclared: boolean;
  automatic: boolean;
  overdue: boolean;
  reviewer: { id: string; name: string; email: string; institution: string | null };
  review: {
    score: number | null;
    recommend: boolean | null;
    comments: string | null;
    submitted: boolean;
    submittedAt: string | null;
    markedUpCopy: { fileId: string; filename: string; sizeBytes: number } | null;
  } | null;
};

export type PaperDetailDTO = {
  id: string;
  reference: string;
  title: string;
  authorNames: string;
  contactEmail: string;
  institution: string;
  topic: string;
  discipline: string;
  paperType: PaperType;
  abstract: string;
  status: SubmissionStatus;
  submittedAt: string | null;
  declarationAt: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  submitter: { id: string; name: string; email: string; institution: string | null };
  file: { id: string; filename: string; sizeBytes: number } | null;
  assignments: PaperAssignmentDTO[];
  averageScore: number | null;
  recommended: number;
  reviewsIn: number;
};

export function toPaperDetailDTO(
  record: PaperDetailRecord,
  now: Date = new Date(),
): PaperDetailDTO {
  const file = record.files[0];
  const assignments: PaperAssignmentDTO[] = record.assignments.map((assignment) => {
    const review = assignment.review;
    const copy = review?.files[0];
    return {
      id: assignment.id,
      status: assignment.status,
      isTiebreaker: assignment.isTiebreaker,
      dueAt: assignment.dueAt.toISOString(),
      assignedAt: assignment.assignedAt.toISOString(),
      completedAt: assignment.completedAt?.toISOString() ?? null,
      declinedAt: assignment.declinedAt?.toISOString() ?? null,
      declineReason: assignment.declineReason,
      conflictDeclared: assignment.conflictDeclared,
      automatic: assignment.assignedBy === null,
      overdue:
        (assignment.status === "PENDING" || assignment.status === "ACCEPTED") &&
        assignment.dueAt < now,
      reviewer: assignment.reviewer,
      review: review
        ? {
            score: review.score,
            recommend: review.recommend,
            comments: review.comments,
            submitted: review.status === "SUBMITTED",
            submittedAt: review.submittedAt?.toISOString() ?? null,
            markedUpCopy: copy
              ? { fileId: copy.id, filename: copy.originalFilename, sizeBytes: copy.sizeBytes }
              : null,
          }
        : null,
    };
  });
  const finished = assignments.filter((assignment) => assignment.review?.submitted);

  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    authorNames: record.authorNames,
    contactEmail: record.contactEmail,
    institution: record.institution,
    topic: record.topic,
    discipline: record.discipline?.name ?? record.disciplineOther ?? "Other",
    paperType: record.paperType,
    abstract: record.abstract,
    status: record.status,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    declarationAt: record.declarationAt?.toISOString() ?? null,
    decisionNote: record.decisionNote,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    decidedBy: record.decidedBy?.name ?? null,
    submitter: record.author,
    file: file ? { id: file.id, filename: file.originalFilename, sizeBytes: file.sizeBytes } : null,
    assignments,
    averageScore: average(finished.map((assignment) => assignment.review?.score ?? 0)),
    recommended: finished.filter((assignment) => assignment.review?.recommend).length,
    reviewsIn: finished.length,
  };
}
