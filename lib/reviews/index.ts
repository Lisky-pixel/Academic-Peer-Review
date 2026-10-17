import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { kickEmailDispatch } from "@/lib/email/outbox";
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
import type { Prisma } from "@/lib/generated/prisma/client";
import { fillReviewerPlaces, LIVE_ASSIGNMENT, settleReviews } from "@/lib/matching";
import { storage } from "@/lib/storage";

/**
 * The reviewer's side: answering an assignment, writing the review, returning
 * a marked-up copy, and submitting.
 *
 * Every query is scoped to "a paper this reviewer has been given and not
 * turned down" — there is no way to read one by id alone. Paper status only
 * changes through lib/matching and the state machine.
 */

/** "Given to this reviewer" — the access rule for everything in this file. */
function heldBy(reviewerId: string): Prisma.SubmissionWhereInput {
  return {
    status: { not: "WITHDRAWN" },
    assignments: { some: { reviewerId, status: { in: [...LIVE_ASSIGNMENT] } } },
  };
}

// ── Reading ────────────────────────────────────────────────────────────────

function paperSelect(reviewerId: string) {
  return {
    id: true,
    reference: true,
    title: true,
    topic: true,
    paperType: true,
    abstract: true,
    status: true,
    disciplineOther: true,
    discipline: { select: { name: true } },
    // Selected here, but only ever exposed by toReviewerPaperDTO(), which
    // hides them when the conference is double-blind.
    authorNames: true,
    institution: true,
    conference: {
      select: { name: true, doubleBlind: true, submissionFormat: true, reviewDeadline: true },
    },
    files: {
      where: { kind: "ORIGINAL" },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { originalFilename: true, sizeBytes: true, storageKey: true },
    },
    assignments: {
      where: { reviewerId, status: { in: [...LIVE_ASSIGNMENT] } },
      select: {
        id: true,
        status: true,
        dueAt: true,
        assignedAt: true,
        isTiebreaker: true,
        review: {
          select: {
            id: true,
            score: true,
            recommend: true,
            comments: true,
            status: true,
            submittedAt: true,
            files: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, originalFilename: true, sizeBytes: true, scrubbedAt: true },
            },
          },
        },
      },
    },
  } satisfies Prisma.SubmissionSelect;
}

export type ReviewerPaperRecord = Prisma.SubmissionGetPayload<{
  select: ReturnType<typeof paperSelect>;
}>;

export function findReviewerPaper(
  reviewerId: string,
  submissionId: string,
): Promise<ReviewerPaperRecord | null> {
  return db.submission.findFirst({
    where: { id: submissionId, ...heldBy(reviewerId) },
    select: paperSelect(reviewerId),
  });
}

const QUEUE_SELECT = {
  id: true,
  status: true,
  dueAt: true,
  assignedAt: true,
  completedAt: true,
  review: { select: { status: true, score: true, recommend: true } },
  submission: {
    select: {
      id: true,
      reference: true,
      title: true,
      topic: true,
      paperType: true,
      status: true,
      conference: { select: { name: true } },
    },
  },
} satisfies Prisma.AssignmentSelect;

export type QueueRecord = Prisma.AssignmentGetPayload<{ select: typeof QUEUE_SELECT }>;

/** Everything this reviewer has been given, answered or not. */
export function findReviewerQueue(reviewerId: string): Promise<QueueRecord[]> {
  return db.assignment.findMany({
    where: {
      reviewerId,
      status: { in: [...LIVE_ASSIGNMENT] },
      submission: { status: { not: "WITHDRAWN" } },
    },
    orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }],
    select: QUEUE_SELECT,
  });
}

// ── Answering the assignment ───────────────────────────────────────────────

export type Outcome<F extends string = never> = { ok: true } | { ok: false; reason: F };

export async function acceptAssignment(
  reviewer: SessionUser,
  submissionId: string,
  ip?: string | null,
): Promise<Outcome<"not_found">> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.assignment.updateMany({
      where: { submissionId, reviewerId: reviewer.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (count !== 1) return { ok: false, reason: "not_found" } as const;
    await tx.activityLog.create({
      data: {
        action: "assignment.accepted",
        entityType: "Submission",
        entityId: submissionId,
        actorId: reviewer.id,
        actorRole: reviewer.role,
        ip: ip ?? null,
      },
    });
    return { ok: true } as const;
  });
}

/**
 * Turns a paper down, before the review is submitted. The place is offered to
 * someone else straight away, with the same rules — and the person declining
 * is never offered this paper again.
 */
export async function declineAssignment(
  reviewer: SessionUser,
  submissionId: string,
  input: { reason: string; conflict: boolean },
  ip?: string | null,
): Promise<Outcome<"not_found" | "reason_required">> {
  const reason = input.reason.trim().slice(0, 1000);
  if (!reason && !input.conflict) return { ok: false, reason: "reason_required" };

  const result = await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.findFirst({
      where: { submissionId, reviewerId: reviewer.id, status: { in: ["PENDING", "ACCEPTED"] } },
      select: { id: true, isTiebreaker: true },
    });
    if (!assignment) return { ok: false, reason: "not_found" } as const;

    const { count } = await tx.assignment.updateMany({
      where: { id: assignment.id, status: { in: ["PENDING", "ACCEPTED"] } },
      data: {
        status: "DECLINED",
        declinedAt: new Date(),
        declineReason: reason || null,
        conflictDeclared: input.conflict,
      },
    });
    if (count !== 1) return { ok: false, reason: "not_found" } as const;

    await tx.activityLog.create({
      data: {
        action: input.conflict ? "assignment.conflict_declared" : "assignment.declined",
        entityType: "Submission",
        entityId: submissionId,
        actorId: reviewer.id,
        actorRole: reviewer.role,
        ip: ip ?? null,
        metadata: { reason: reason || null },
      },
    });

    // The replacement is chosen by the system, not by the person declining.
    const system = { id: null, role: "SYSTEM" } as const;
    await fillReviewerPlaces(tx, submissionId, system, { tiebreaker: assignment.isTiebreaker });
    await settleReviews(tx, submissionId, system);
    return { ok: true } as const;
  });

  if (result.ok) kickEmailDispatch();
  return result;
}

// ── Writing the review ─────────────────────────────────────────────────────

export type ReviewInput = { score: number | null; recommend: boolean | null; comments: string };

/** The reviewer's open assignment on a paper, if the review can still be written. */
async function openAssignment(tx: Prisma.TransactionClient, reviewerId: string, id: string) {
  return tx.assignment.findFirst({
    where: {
      submissionId: id,
      reviewerId,
      status: { in: ["PENDING", "ACCEPTED"] },
      submission: { status: "UNDER_REVIEW" },
    },
    select: { id: true, status: true, review: { select: { id: true, status: true } } },
  });
}

/**
 * Saves the review so far. Safe to call often with partial input. Saving
 * also accepts the paper, if the reviewer had not already.
 */
export async function saveReview(
  reviewer: SessionUser,
  submissionId: string,
  input: ReviewInput,
): Promise<Outcome<"not_editable">> {
  return db.$transaction(async (tx) => {
    const assignment = await openAssignment(tx, reviewer.id, submissionId);
    if (!assignment || assignment.review?.status === "SUBMITTED") {
      return { ok: false, reason: "not_editable" } as const;
    }

    if (assignment.status === "PENDING") {
      await tx.assignment.update({
        where: { id: assignment.id },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
    }

    const data = {
      score: input.score,
      recommend: input.recommend,
      comments: input.comments.trim().slice(0, 20_000) || null,
    };
    await tx.review.upsert({
      where: { assignmentId: assignment.id },
      create: { submissionId, assignmentId: assignment.id, ...data },
      update: data,
    });
    return { ok: true } as const;
  });
}

export type SubmitReviewResult =
  | { ok: true }
  | { ok: false; reason: "not_editable" }
  | { ok: false; reason: "incomplete"; missing: string[] };

/** What is still missing before a review can be sent. */
export function missingFromReview(review: {
  score: number | null;
  recommend: boolean | null;
  comments: string | null;
}): string[] {
  const missing: string[] = [];
  if (!review.score || review.score < 1 || review.score > 5) missing.push("a score from 1 to 5");
  if (review.recommend === null) missing.push("your recommendation");
  if (!review.comments || review.comments.trim().length < 20) {
    missing.push("comments for the authors (at least a sentence or two)");
  }
  return missing;
}

/**
 * Sends the review. It cannot be changed afterwards. If it was the last one
 * the paper was waiting for, the organisers are told it is ready for a
 * decision — or, if the reviews disagree, a tie-breaker is found first.
 */
export async function submitReview(
  reviewer: SessionUser,
  submissionId: string,
  ip?: string | null,
): Promise<SubmitReviewResult> {
  const result = await db.$transaction(async (tx): Promise<SubmitReviewResult> => {
    const assignment = await tx.assignment.findFirst({
      where: {
        submissionId,
        reviewerId: reviewer.id,
        status: "ACCEPTED",
        submission: { status: "UNDER_REVIEW" },
      },
      select: {
        id: true,
        review: {
          select: { id: true, status: true, score: true, recommend: true, comments: true },
        },
      },
    });
    const review = assignment?.review;
    if (!assignment || !review || review.status === "SUBMITTED") {
      return { ok: false, reason: "not_editable" };
    }

    const missing = missingFromReview(review);
    if (missing.length > 0) return { ok: false, reason: "incomplete", missing };

    const now = new Date();
    const { count } = await tx.review.updateMany({
      where: { id: review.id, status: "DRAFT" },
      data: { status: "SUBMITTED", submittedAt: now },
    });
    if (count !== 1) return { ok: false, reason: "not_editable" };
    await tx.assignment.update({
      where: { id: assignment.id },
      data: { status: "COMPLETED", completedAt: now },
    });
    await tx.activityLog.create({
      data: {
        action: "review.submitted",
        entityType: "Submission",
        entityId: submissionId,
        actorId: reviewer.id,
        actorRole: reviewer.role,
        ip: ip ?? null,
        metadata: { score: review.score, recommend: review.recommend },
      },
    });

    await settleReviews(tx, submissionId, reviewer);
    return { ok: true };
  });

  if (result.ok) kickEmailDispatch();
  return result;
}

// ── The marked-up copy ─────────────────────────────────────────────────────

const RAW_KEY = /^submissions\/([0-9a-f-]{36})\/annotated-raw\/[0-9a-f-]{36}\.(pdf|docx)$/;

export type PrepareAnnotatedResult =
  | { ok: true; url: string; key: string; mimeType: string }
  | { ok: false; reason: FileRejection | "not_editable" };

export async function prepareAnnotatedUpload(
  reviewerId: string,
  submissionId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<PrepareAnnotatedResult> {
  const assignment = await openAssignment(db, reviewerId, submissionId);
  if (!assignment || assignment.review?.status === "SUBMITTED") {
    return { ok: false, reason: "not_editable" };
  }

  const check = checkDeclaredFile(file, env.MAX_UPLOAD_BYTES);
  if (!check.ok) return check;
  // Only formats whose metadata can be reliably removed.
  if (!isScrubbable(check.kind) || check.kind === "txt") {
    return { ok: false, reason: "unsupported_type" };
  }

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
 * stores only the scrubbed copy. The raw upload is deleted whatever happens.
 */
export async function confirmAnnotatedUpload(
  reviewer: SessionUser,
  submissionId: string,
  rawKey: string,
): Promise<ConfirmAnnotatedResult> {
  const match = RAW_KEY.exec(rawKey);
  if (!match || match[1] !== submissionId) return { ok: false, reason: "not_uploaded" };
  const kind = match[2] as ScrubbableKind;

  try {
    const paper = await db.submission.findUnique({
      where: { id: submissionId },
      select: { reference: true },
    });
    // Saving creates the review row the file belongs to, and checks access.
    const saved = await db.assignment.findFirst({
      where: { submissionId, reviewerId: reviewer.id, status: { in: ["PENDING", "ACCEPTED"] } },
      select: { review: { select: { id: true, status: true } } },
    });
    if (!paper || !saved) return { ok: false, reason: "not_editable" };
    if (!saved.review) {
      const created = await saveReview(reviewer, submissionId, {
        score: null,
        recommend: null,
        comments: "",
      });
      if (!created.ok) return created;
    } else if (saved.review.status === "SUBMITTED") {
      return { ok: false, reason: "not_editable" };
    }
    const review = await db.review.findFirstOrThrow({
      where: { submissionId, assignment: { reviewerId: reviewer.id } },
      select: { id: true },
    });

    const info = await storage().head(rawKey);
    if (!info) return { ok: false, reason: "not_uploaded" };
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
      const previous = await tx.storedFile.findMany({
        where: { reviewId: review.id },
        select: { id: true, storageKey: true },
      });
      await tx.storedFile.deleteMany({ where: { id: { in: previous.map((file) => file.id) } } });
      await tx.storedFile.create({
        data: {
          submissionId,
          reviewId: review.id,
          kind: "ANNOTATED",
          storageKey: key,
          // Named from the reference: the reviewer's own filename is not kept.
          originalFilename: reviewedFilename(paper.reference, kind),
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
 * A short-lived download link for the paper itself, or this reviewer's own
 * marked-up copy. When the conference is double-blind the paper downloads
 * under its reference, not the name it was uploaded with.
 */
export async function reviewerFileUrl(
  reviewerId: string,
  submissionId: string,
  which: "paper" | "annotated",
): Promise<string | null> {
  if (which === "annotated") {
    const file = await db.storedFile.findFirst({
      where: {
        kind: "ANNOTATED",
        submission: { id: submissionId, ...heldBy(reviewerId) },
        review: { assignment: { reviewerId } },
      },
      orderBy: { createdAt: "desc" },
      select: { storageKey: true, originalFilename: true },
    });
    return file
      ? storage().presignDownload({ key: file.storageKey, filename: file.originalFilename })
      : null;
  }

  const file = await db.storedFile.findFirst({
    where: { kind: "ORIGINAL", submission: { id: submissionId, ...heldBy(reviewerId) } },
    orderBy: { createdAt: "desc" },
    select: {
      storageKey: true,
      originalFilename: true,
      submission: { select: { reference: true, conference: { select: { doubleBlind: true } } } },
    },
  });
  if (!file) return null;
  const filename = file.submission.conference.doubleBlind
    ? `${file.submission.reference}.${extensionOf(file.originalFilename)}`
    : file.originalFilename;
  return storage().presignDownload({ key: file.storageKey, filename });
}
