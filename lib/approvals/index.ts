import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { type DocumentPreview, previewOf } from "@/lib/reviews/preview";
import { storage } from "@/lib/storage";
import { SYSTEM_ACTOR, transition, type TransitionFailure } from "@/lib/workflow/state-machine";

/**
 * The second admin gate: reading a submitted review and either approving it
 * or sending it back — and then the author receiving it.
 *
 * The admin functions trust that their caller has been through
 * `requireRole("ADMIN")`. The author functions are scoped to the author and
 * only ever return a review that has been approved, with a file that has been
 * scrubbed.
 */

const CRITERIA = {
  orderBy: { sortOrder: "asc" },
  select: { id: true, label: true, helpText: true, inputType: true, maxRating: true },
} as const;

// ── The administrator reading a review ─────────────────────────────────────

const ADMIN_REVIEW_SELECT = {
  id: true,
  reference: true,
  status: true,
  files: {
    orderBy: { createdAt: "desc" },
    select: {
      kind: true,
      storageKey: true,
      originalFilename: true,
      sizeBytes: true,
      uploadedById: true,
      scrubbedAt: true,
    },
  },
  assignments: {
    where: { isActive: true },
    select: {
      reviewerId: true,
      reviewer: { select: { name: true } },
      review: {
        select: {
          id: true,
          status: true,
          revisionRound: true,
          submittedAt: true,
          template: { select: { name: true, criteria: CRITERIA } },
          responses: { select: { criterionId: true, rating: true, comment: true } },
          decisions: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              decision: true,
              note: true,
              createdAt: true,
              admin: { select: { name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.SubmissionSelect;

export type AdminReviewRecord = Prisma.SubmissionGetPayload<{ select: typeof ADMIN_REVIEW_SELECT }>;

/** The review on a submission's live assignment, or null if none was started. */
export async function findReviewForAdmin(submissionId: string): Promise<AdminReviewRecord | null> {
  const record = await db.submission.findFirst({
    where: { id: submissionId, status: { not: "DRAFT" } },
    select: ADMIN_REVIEW_SELECT,
  });
  return record?.assignments[0]?.review ? record : null;
}

/** The current reviewer's annotated file on a record, if it has been scrubbed. */
export function annotatedFileOf<
  F extends { kind: string; uploadedById: string; scrubbedAt: Date | null },
>(record: { files: F[]; assignments: Array<{ reviewerId: string }> }): F | undefined {
  const reviewerId = record.assignments[0]?.reviewerId;
  return record.files.find(
    (file) => file.kind === "ANNOTATED" && file.uploadedById === reviewerId && file.scrubbedAt,
  );
}

/** In-page previews of both documents, for reading them side by side. */
export async function findAdminPreviews(
  record: AdminReviewRecord,
): Promise<{ original: DocumentPreview; annotated: DocumentPreview }> {
  const original = record.files.find((file) => file.kind === "ORIGINAL");
  const annotated = annotatedFileOf(record);
  const [originalPreview, annotatedPreview] = await Promise.all([
    original ? previewOf(original) : { type: "none" as const },
    annotated ? previewOf(annotated) : { type: "none" as const },
  ]);
  return { original: originalPreview, annotated: annotatedPreview };
}

/** A short-lived link for an administrator to download the annotated file. */
export async function adminAnnotatedDownloadUrl(submissionId: string): Promise<string | null> {
  const record = await findReviewForAdmin(submissionId);
  const file = record ? annotatedFileOf(record) : undefined;
  if (!file) return null;
  return storage().presignDownload({ key: file.storageKey, filename: file.originalFilename });
}

// ── Deciding ───────────────────────────────────────────────────────────────

export type DecisionFailure = TransitionFailure | "no_review" | "not_scrubbed" | "note_required";
export type DecisionResult = { ok: true } | { ok: false; reason: DecisionFailure };

/**
 * Approves the review, which is what releases it to the author.
 *
 * Refused unless the annotated file carries a scrub timestamp. That check is
 * redundant with how the file got there — and deliberately so: this is the
 * last point before a reviewer's file can reach an author.
 */
export async function approveReview(
  admin: SessionUser,
  submissionId: string,
  note: string = "",
  ip?: string | null,
): Promise<DecisionResult> {
  const record = await findReviewForAdmin(submissionId);
  const assignment = record?.assignments[0];
  const review = assignment?.review;
  if (!record || !assignment || !review) return { ok: false, reason: "no_review" };
  if (!annotatedFileOf(record)) return { ok: false, reason: "not_scrubbed" };

  const trimmed = note.trim().slice(0, 2000) || null;

  const result = await transition({
    submissionId,
    event: "approve",
    actor: admin,
    ip,
    apply: async (tx) => {
      await tx.adminDecision.create({
        data: { reviewId: review.id, adminId: admin.id, decision: "APPROVED", note: trimmed },
      });
      await tx.assignment.updateMany({
        where: { submissionId, isActive: true },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    },
  });
  return result.ok ? { ok: true } : result;
}

/**
 * Sends the review back to the reviewer with a note saying what to change.
 * The review reopens for editing and its round number goes up; each round's
 * decision is kept.
 */
export async function requestRevision(
  admin: SessionUser,
  submissionId: string,
  note: string,
  ip?: string | null,
): Promise<DecisionResult> {
  const trimmed = note.trim().slice(0, 2000);
  if (!trimmed) return { ok: false, reason: "note_required" };

  const record = await findReviewForAdmin(submissionId);
  const assignment = record?.assignments[0];
  const review = assignment?.review;
  if (!record || !assignment || !review) return { ok: false, reason: "no_review" };

  const result = await transition({
    submissionId,
    event: "request_revision",
    actor: admin,
    ip,
    metadata: { reason: trimmed },
    apply: async (tx) => {
      await tx.adminDecision.create({
        data: {
          reviewId: review.id,
          adminId: admin.id,
          decision: "REVISION_REQUESTED",
          note: trimmed,
        },
      });
      await tx.review.update({
        where: { id: review.id },
        data: { status: "DRAFT", revisionRound: { increment: 1 } },
      });
      await tx.notification.create({
        data: {
          userId: assignment.reviewerId,
          type: "REVISION_REQUESTED",
          title: "Changes requested on your review",
          body: `The administrator has asked for changes to your review of ${record.reference}.`,
          submissionId,
          linkUrl: `/reviewer/reviews/${submissionId}`,
        },
      });
    },
  });
  return result.ok ? { ok: true } : result;
}

// ── The author receiving the review ────────────────────────────────────────

const OWN_REVIEW_SELECT = {
  id: true,
  reference: true,
  status: true,
  approvedAt: true,
  files: {
    where: { kind: "ANNOTATED", scrubbedAt: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      kind: true,
      storageKey: true,
      originalFilename: true,
      sizeBytes: true,
      uploadedById: true,
      scrubbedAt: true,
    },
  },
  assignments: {
    where: { isActive: true },
    select: {
      // Needed to pick the right file. It is never copied into a DTO:
      // toUserReviewDTO() has no field that could hold it.
      reviewerId: true,
      review: {
        select: {
          template: { select: { criteria: CRITERIA } },
          responses: { select: { criterionId: true, rating: true, comment: true } },
        },
      },
    },
  },
} satisfies Prisma.SubmissionSelect;

export type OwnReviewRecord = Prisma.SubmissionGetPayload<{ select: typeof OWN_REVIEW_SELECT }>;

/**
 * The review of an author's own submission — only once an administrator has
 * approved it. Before that this returns null, whatever state the review is in.
 */
export async function findOwnReview(
  authorId: string,
  submissionId: string,
): Promise<OwnReviewRecord | null> {
  const record = await db.submission.findFirst({
    where: { id: submissionId, authorId, status: { in: ["APPROVED", "DELIVERED"] } },
    select: OWN_REVIEW_SELECT,
  });
  return record?.assignments[0]?.review ? record : null;
}

/**
 * Records that the author has opened or downloaded their review, which is
 * what DELIVERED means. Safe to call repeatedly: only the first call on an
 * APPROVED submission changes anything.
 */
export async function markDelivered(
  authorId: string,
  submissionId: string,
  trigger: "view" | "download",
): Promise<void> {
  const approved = await db.submission.count({
    where: { id: submissionId, authorId, status: "APPROVED" },
  });
  if (approved === 0) return;

  await transition({
    submissionId,
    event: "deliver",
    actor: SYSTEM_ACTOR,
    metadata: { trigger },
  });
}

/**
 * A short-lived link for the author to download the annotated file.
 *
 * The query itself only matches files with a scrub timestamp, on a submission
 * that is the author's own and has been approved. There is no branch that
 * serves an unscrubbed reviewer file.
 */
export async function ownReviewedFileUrl(
  authorId: string,
  submissionId: string,
): Promise<string | null> {
  const record = await findOwnReview(authorId, submissionId);
  const file = record ? annotatedFileOf(record) : undefined;
  if (!file) return null;

  await markDelivered(authorId, submissionId, "download");
  return storage().presignDownload({ key: file.storageKey, filename: file.originalFilename });
}
