import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  isScrubbable,
  reviewedFilename,
  type ScrubbableKind,
  type ScrubFailure,
  scrubDocument,
} from "@/lib/files/scrub";
import {
  checkDeclaredFile,
  checkFileContent,
  extensionOf,
  type FileRejection,
} from "@/lib/files/validate";
import type { Prisma, SubmissionStatus } from "@/lib/generated/prisma/client";
import {
  type AnswerInput,
  type Criterion,
  normaliseAnswer,
  unansweredCriteria,
} from "@/lib/reviews/completeness";
import { storage } from "@/lib/storage";
import { transition, type TransitionFailure } from "@/lib/workflow/state-machine";

/**
 * The reviewer's side: answering an assignment, writing the review, returning
 * the annotated file, and submitting.
 *
 * Every query is scoped to "a submission this reviewer currently holds" —
 * there is no way to read one by id alone. Status changes go through
 * `transition()`, which independently checks the reviewer holds the live
 * assignment.
 */

/** Statuses in which the review can still be written. */
const EDITABLE: SubmissionStatus[] = ["ACCEPTED", "IN_REVIEW", "REVISION_REQUESTED"];

// ── Reading ────────────────────────────────────────────────────────────────

/** "Held by this reviewer" — the access rule for everything in this file. */
function heldBy(reviewerId: string): Prisma.SubmissionWhereInput {
  return { assignments: { some: { reviewerId, isActive: true } } };
}

function submissionSelect(reviewerId: string) {
  return {
    id: true,
    reference: true,
    title: true,
    purpose: true,
    description: true,
    instructions: true,
    focusAreas: true,
    status: true,
    authorVisibleToReviewer: true,
    documentTypeId: true,
    documentType: { select: { id: true, name: true } },
    // Selected here, but only ever exposed by toReviewerSubmissionDTO(), which
    // applies authorVisibleToReviewer.
    author: { select: { name: true } },
    files: {
      orderBy: { createdAt: "desc" },
      select: {
        kind: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        uploadedById: true,
        scrubbedAt: true,
      },
    },
    assignments: {
      where: { reviewerId, isActive: true },
      select: {
        id: true,
        status: true,
        dueAt: true,
        assignedAt: true,
        review: {
          select: {
            id: true,
            status: true,
            templateId: true,
            revisionRound: true,
            submittedAt: true,
            responses: { select: { criterionId: true, rating: true, comment: true } },
            decisions: {
              where: { decision: "REVISION_REQUESTED" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { note: true, createdAt: true },
            },
          },
        },
      },
    },
  } satisfies Prisma.SubmissionSelect;
}

export type ReviewerSubmissionRecord = Prisma.SubmissionGetPayload<{
  select: ReturnType<typeof submissionSelect>;
}>;

export function findReviewerSubmission(
  reviewerId: string,
  submissionId: string,
): Promise<ReviewerSubmissionRecord | null> {
  return db.submission.findFirst({
    where: { id: submissionId, ...heldBy(reviewerId) },
    select: submissionSelect(reviewerId),
  });
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  criteria: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      label: true,
      helpText: true,
      inputType: true,
      maxRating: true,
      required: true,
    },
  },
} satisfies Prisma.ReviewTemplateSelect;

export type TemplateRecord = Prisma.ReviewTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

/**
 * The questions for a review. Once a review exists it is pinned to the
 * template it started with, so editing a template later never changes the
 * questions of a review already in progress.
 */
export function findTemplateFor(record: {
  documentTypeId: string;
  assignments: Array<{ review: { templateId: string } | null }>;
}): Promise<TemplateRecord | null> {
  const pinned = record.assignments[0]?.review?.templateId;
  return db.reviewTemplate.findFirst({
    where: pinned ? { id: pinned } : { documentTypeId: record.documentTypeId, isActive: true },
    select: TEMPLATE_SELECT,
  });
}

const QUEUE_SELECT = {
  id: true,
  status: true,
  dueAt: true,
  assignedAt: true,
  review: { select: { submittedAt: true } },
  submission: {
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      authorVisibleToReviewer: true,
      author: { select: { name: true } },
      documentType: { select: { name: true } },
    },
  },
} satisfies Prisma.AssignmentSelect;

export type QueueRecord = Prisma.AssignmentGetPayload<{ select: typeof QUEUE_SELECT }>;

/** Everything this reviewer currently holds or has finished. */
export function findReviewerQueue(reviewerId: string): Promise<QueueRecord[]> {
  return db.assignment.findMany({
    where: { reviewerId, isActive: true, submission: { status: { not: "CANCELLED" } } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { assignedAt: "asc" }],
    select: QUEUE_SELECT,
  });
}

// ── Answering the assignment ───────────────────────────────────────────────

type Outcome<F extends string = never> =
  { ok: true } | { ok: false; reason: TransitionFailure | F };

export async function acceptAssignment(
  reviewer: SessionUser,
  submissionId: string,
  ip?: string | null,
): Promise<Outcome> {
  const result = await transition({
    submissionId,
    event: "accept",
    actor: reviewer,
    ip,
    apply: async (tx) => {
      await tx.assignment.updateMany({
        where: { submissionId, reviewerId: reviewer.id, isActive: true },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
    },
  });
  return result.ok ? { ok: true } : result;
}

/**
 * Turns an assignment down. The submission goes back to waiting for a
 * reviewer, and the declined assignment is retired with its reason so the
 * administrator can see why.
 */
export async function declineAssignment(
  reviewer: SessionUser,
  submissionId: string,
  reason: string,
  ip?: string | null,
): Promise<Outcome<"reason_required">> {
  const trimmed = reason.trim().slice(0, 1000);
  if (!trimmed) return { ok: false, reason: "reason_required" };

  const result = await transition({
    submissionId,
    event: "decline",
    actor: reviewer,
    ip,
    metadata: { reason: trimmed },
    apply: async (tx) => {
      await tx.assignment.updateMany({
        where: { submissionId, reviewerId: reviewer.id, isActive: true },
        data: {
          status: "DECLINED",
          declinedAt: new Date(),
          declineReason: trimmed,
          // NULL, never false — see the unique index on (submissionId, isActive).
          isActive: null,
        },
      });
    },
  });
  return result.ok ? { ok: true } : result;
}

// ── Writing the review ─────────────────────────────────────────────────────

async function writeAnswers(
  tx: Prisma.TransactionClient,
  input: { submissionId: string; assignmentId: string; templateId: string },
  answers: Array<{ criterionId: string; rating: number | null; comment: string | null }>,
): Promise<void> {
  const review = await tx.review.upsert({
    where: { assignmentId: input.assignmentId },
    create: input,
    // Editing again after a revision request reopens the review.
    update: { status: "DRAFT" },
    select: { id: true },
  });

  for (const answer of answers) {
    await tx.reviewResponse.upsert({
      where: { reviewId_criterionId: { reviewId: review.id, criterionId: answer.criterionId } },
      create: { reviewId: review.id, ...answer },
      update: { rating: answer.rating, comment: answer.comment },
    });
  }
}

/**
 * Saves the reviewer's answers so far. Called by autosave, so it must be safe
 * to call often and with partial input: only the criteria sent are touched.
 *
 * The first save is what starts the review — it moves the submission from
 * ACCEPTED to IN_REVIEW and creates the Review row, in one transaction.
 */
export async function saveReviewDraft(
  reviewer: SessionUser,
  submissionId: string,
  inputs: AnswerInput[],
  ip?: string | null,
): Promise<Outcome<"not_editable">> {
  const record = await findReviewerSubmission(reviewer.id, submissionId);
  const assignment = record?.assignments[0];
  if (!record || !assignment || !EDITABLE.includes(record.status)) {
    return { ok: false, reason: "not_editable" };
  }

  const template = await findTemplateFor(record);
  if (!template) return { ok: false, reason: "not_editable" };

  const answers = inputs
    .slice(0, 200)
    .map((input) => normaliseAnswer(template.criteria, input))
    .filter((answer) => answer !== null);
  const target = { submissionId, assignmentId: assignment.id, templateId: template.id };

  if (record.status === "ACCEPTED") {
    const result = await transition({
      submissionId,
      event: "start_review",
      actor: reviewer,
      ip,
      apply: (tx) => writeAnswers(tx, target, answers),
    });
    return result.ok ? { ok: true } : result;
  }

  await db.$transaction((tx) => writeAnswers(tx, target, answers));
  return { ok: true };
}

// ── The annotated file ─────────────────────────────────────────────────────

const RAW_KEY = /^submissions\/([0-9a-f-]{36})\/annotated-raw\/[0-9a-f-]{36}\.(pdf|docx|txt)$/;

export type PrepareAnnotatedResult =
  | { ok: true; url: string; key: string; mimeType: string }
  | { ok: false; reason: FileRejection | "not_editable" };

async function isEditableBy(reviewerId: string, submissionId: string) {
  return db.submission.findFirst({
    where: { id: submissionId, status: { in: EDITABLE }, ...heldBy(reviewerId) },
    select: { id: true, reference: true },
  });
}

export async function prepareAnnotatedUpload(
  reviewerId: string,
  submissionId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<PrepareAnnotatedResult> {
  if (!(await isEditableBy(reviewerId, submissionId))) return { ok: false, reason: "not_editable" };

  const check = checkDeclaredFile(file, env.MAX_UPLOAD_BYTES);
  if (!check.ok) return check;
  // Only formats whose metadata can be reliably removed. A legacy .doc or an
  // .rtf would reach the author with the reviewer's name still inside.
  if (!isScrubbable(check.kind)) return { ok: false, reason: "unsupported_type" };

  const key = `submissions/${submissionId}/annotated-raw/${randomUUID()}.${extensionOf(file.filename)}`;
  const url = await storage().presignUpload({
    key,
    contentType: check.mimeType,
    sizeBytes: file.sizeBytes,
  });
  return { ok: true, url, key, mimeType: check.mimeType };
}

export type ConfirmAnnotatedResult =
  | { ok: true }
  | { ok: false; reason: FileRejection | ScrubFailure | "not_editable" | "not_uploaded" };

/**
 * Takes the reviewer's uploaded file, strips their identity from it, and
 * stores only the scrubbed copy.
 *
 * The raw upload is deleted whatever happens. The row is created with
 * `scrubbedAt` set, which is what a later author-facing download checks for:
 * there is no path by which an unscrubbed reviewer file gets a StoredFile.
 */
export async function confirmAnnotatedUpload(
  reviewer: SessionUser,
  submissionId: string,
  rawKey: string,
): Promise<ConfirmAnnotatedResult> {
  const submission = await isEditableBy(reviewer.id, submissionId);
  if (!submission) return { ok: false, reason: "not_editable" };

  const match = RAW_KEY.exec(rawKey);
  if (!match || match[1] !== submissionId) return { ok: false, reason: "not_uploaded" };
  const kind = match[2] as ScrubbableKind;

  const info = await storage().head(rawKey);
  if (!info) return { ok: false, reason: "not_uploaded" };

  try {
    if (info.sizeBytes > env.MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };

    const raw = await storage().read(rawKey);
    const content = checkFileContent(kind, raw, env.MAX_UPLOAD_BYTES);
    if (!content.ok) return content;

    const scrubbed = await scrubDocument(kind, raw);
    if (!scrubbed.ok) return scrubbed;

    const declared = checkDeclaredFile(
      { filename: `file.${kind}`, mimeType: info.contentType ?? "", sizeBytes: raw.length },
      env.MAX_UPLOAD_BYTES,
    );
    const mimeType = declared.ok ? declared.mimeType : "application/octet-stream";
    const key = `submissions/${submissionId}/annotated/${randomUUID()}.${kind}`;
    await storage().write(key, scrubbed.bytes, mimeType);

    const replaced = await db.$transaction(async (tx) => {
      // Only this reviewer's earlier upload. A previous reviewer's file, from
      // before a reassignment, belongs to their assignment's history.
      const previous = await tx.storedFile.findMany({
        where: { submissionId, kind: "ANNOTATED", uploadedById: reviewer.id },
        select: { id: true, storageKey: true },
      });
      await tx.storedFile.deleteMany({ where: { id: { in: previous.map((file) => file.id) } } });
      await tx.storedFile.create({
        data: {
          submissionId,
          kind: "ANNOTATED",
          storageKey: key,
          // Named from the reference: the reviewer's own filename is not kept.
          originalFilename: reviewedFilename(submission.reference, kind),
          mimeType,
          sizeBytes: scrubbed.bytes.length,
          checksum: createHash("sha256").update(scrubbed.bytes).digest("hex"),
          uploadedById: reviewer.id,
          scrubbedAt: new Date(),
        },
      });
      return previous;
    });
    await Promise.allSettled(replaced.map((file) => storage().delete(file.storageKey)));

    return { ok: true };
  } finally {
    // The unscrubbed original must not outlive this function.
    await storage()
      .delete(rawKey)
      .catch(() => undefined);
  }
}

/**
 * A short-lived download link for a file on a submission this reviewer
 * holds: the author's document, or the reviewer's own annotated copy.
 *
 * When the author is hidden from the reviewer, the author's document is
 * downloaded under the reference rather than its real filename, which is
 * often the author's name.
 */
export async function reviewerFileUrl(
  reviewerId: string,
  submissionId: string,
  which: "original" | "annotated",
): Promise<string | null> {
  const file = await db.storedFile.findFirst({
    where: {
      submission: { id: submissionId, ...heldBy(reviewerId) },
      ...(which === "original"
        ? { kind: "ORIGINAL" }
        : { kind: "ANNOTATED", uploadedById: reviewerId }),
    },
    orderBy: { createdAt: "desc" },
    select: {
      storageKey: true,
      originalFilename: true,
      submission: { select: { reference: true, authorVisibleToReviewer: true } },
    },
  });
  if (!file) return null;

  const filename =
    which === "original" && !file.submission.authorVisibleToReviewer
      ? `${file.submission.reference}.${extensionOf(file.originalFilename)}`
      : file.originalFilename;
  return storage().presignDownload({ key: file.storageKey, filename });
}

// ── Submitting ─────────────────────────────────────────────────────────────

export type SubmitReviewResult =
  | { ok: true }
  | { ok: false; reason: TransitionFailure | "not_editable" | "no_annotated_file" }
  | { ok: false; reason: "incomplete"; missing: string[] };

/**
 * Sends the finished review to the administrator. Refused until every
 * required criterion is answered and a scrubbed annotated file is attached.
 */
export async function submitReview(
  reviewer: SessionUser,
  submissionId: string,
  ip?: string | null,
): Promise<SubmitReviewResult> {
  const record = await findReviewerSubmission(reviewer.id, submissionId);
  const assignment = record?.assignments[0];
  const review = assignment?.review;
  if (!record || !assignment || !EDITABLE.includes(record.status)) {
    return { ok: false, reason: "not_editable" };
  }

  const template = await findTemplateFor(record);
  if (!template) return { ok: false, reason: "not_editable" };

  const answers = Object.fromEntries(
    (review?.responses ?? []).map((response) => [response.criterionId, response]),
  );
  const missing = unansweredCriteria(template.criteria as Criterion[], answers);
  if (!review || missing.length > 0) {
    return {
      ok: false,
      reason: "incomplete",
      missing: missing.map((criterion) => criterion.label),
    };
  }

  const hasAnnotated = record.files.some(
    (file) => file.kind === "ANNOTATED" && file.uploadedById === reviewer.id && file.scrubbedAt,
  );
  if (!hasAnnotated) return { ok: false, reason: "no_annotated_file" };

  const result = await transition({
    submissionId,
    event: record.status === "REVISION_REQUESTED" ? "resubmit_review" : "submit_review",
    actor: reviewer,
    ip,
    apply: async (tx) => {
      await tx.review.update({
        where: { id: review.id },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      });
    },
  });
  return result.ok ? { ok: true } : result;
}
