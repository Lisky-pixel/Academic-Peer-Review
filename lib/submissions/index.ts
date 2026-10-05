import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  checkDeclaredFile,
  checkFileContent,
  type DocumentKind,
  extensionOf,
  type FileRejection,
} from "@/lib/files/validate";
import type { Prisma, SubmissionStatus } from "@/lib/generated/prisma/client";
import { storage } from "@/lib/storage";
import type { SubmissionDetails } from "@/lib/submissions/schema";
import { transition, type TransitionFailure } from "@/lib/workflow/state-machine";

/**
 * Submissions, from the author's side: drafting, attaching the document,
 * submitting, and withdrawing.
 *
 * Every function that takes an `authorId` or `author` scopes its queries to
 * that person, so "not found" and "not yours" are the same answer and ids
 * cannot be probed. Status never changes here except through `transition()`.
 */

// ── Reference numbers ──────────────────────────────────────────────────────

/**
 * Allocates the next reference for the current year, e.g. "RF-2026-0147".
 *
 * One atomic upsert on the per-year counter, so two people submitting at the
 * same instant get consecutive numbers rather than the same one. Numbers are
 * never reused, so a withdrawn draft leaves a gap; that is intended.
 */
export async function allocateReference(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "ReferenceCounter" ("year", "lastValue") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "lastValue" = "ReferenceCounter"."lastValue" + 1
    RETURNING "lastValue"
  `;
  return formatReference(year, rows[0]!.lastValue);
}

export function formatReference(year: number, sequence: number): string {
  return `RF-${year}-${String(sequence).padStart(4, "0")}`;
}

// ── Reading ────────────────────────────────────────────────────────────────

const OWN_SUBMISSION_SELECT = {
  id: true,
  reference: true,
  title: true,
  purpose: true,
  description: true,
  instructions: true,
  focusAreas: true,
  deadline: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  documentType: { select: { id: true, name: true } },
  files: {
    where: { kind: "ORIGINAL" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, originalFilename: true, sizeBytes: true, createdAt: true },
  },
} satisfies Prisma.SubmissionSelect;

export type OwnSubmissionRecord = Prisma.SubmissionGetPayload<{
  select: typeof OWN_SUBMISSION_SELECT;
}>;

export function findOwnSubmissions(authorId: string): Promise<OwnSubmissionRecord[]> {
  return db.submission.findMany({
    where: { authorId },
    orderBy: { updatedAt: "desc" },
    select: OWN_SUBMISSION_SELECT,
  });
}

export function findOwnSubmission(
  authorId: string,
  submissionId: string,
): Promise<OwnSubmissionRecord | null> {
  return db.submission.findFirst({
    where: { id: submissionId, authorId },
    select: OWN_SUBMISSION_SELECT,
  });
}

export function findDocumentTypes() {
  return db.documentType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true },
  });
}

const ADMIN_SUBMISSION_SELECT = {
  id: true,
  reference: true,
  title: true,
  status: true,
  deadline: true,
  createdAt: true,
  submittedAt: true,
  documentType: { select: { id: true, name: true } },
  author: { select: { id: true, name: true, email: true } },
  assignments: {
    where: { isActive: true },
    select: { dueAt: true, reviewer: { select: { name: true } } },
  },
} satisfies Prisma.SubmissionSelect;

export type AdminSubmissionRecord = Prisma.SubmissionGetPayload<{
  select: typeof ADMIN_SUBMISSION_SELECT;
}>;

export type AdminSubmissionFilter = {
  documentTypeId?: string;
  /** "week": due within seven days. "overdue": already past its deadline. */
  due?: "week" | "overdue";
};

/** Everything authors have submitted. Drafts are private until submitted. */
export function findSubmissionsForAdmin(
  statuses?: SubmissionStatus[],
  filter: AdminSubmissionFilter = {},
  now: Date = new Date(),
): Promise<AdminSubmissionRecord[]> {
  const inAWeek = new Date(now.getTime() + 7 * 86_400_000);
  return db.submission.findMany({
    where: {
      status: statuses ? { in: statuses } : { not: "DRAFT" },
      documentTypeId: filter.documentTypeId,
      deadline:
        filter.due === "overdue"
          ? { lt: now }
          : filter.due === "week"
            ? { gte: now, lte: inAWeek }
            : undefined,
    },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    select: ADMIN_SUBMISSION_SELECT,
  });
}

// ── Drafting ───────────────────────────────────────────────────────────────

async function defaultAuthorVisibility(): Promise<boolean> {
  const setting = await db.appSetting.findUnique({ where: { key: "defaultAuthorVisibility" } });
  return typeof setting?.value === "boolean" ? setting.value : true;
}

export type DraftResult = { ok: true; id: string } | { ok: false; reason: "unknown_document_type" };

async function documentTypeExists(id: string): Promise<boolean> {
  return (await db.documentType.count({ where: { id, isActive: true } })) === 1;
}

export async function createDraft(
  author: SessionUser,
  details: SubmissionDetails,
): Promise<DraftResult> {
  if (!(await documentTypeExists(details.documentTypeId))) {
    return { ok: false, reason: "unknown_document_type" };
  }
  const authorVisibleToReviewer = await defaultAuthorVisibility();

  const submission = await db.$transaction(async (tx) => {
    const created = await tx.submission.create({
      data: {
        ...details,
        reference: await allocateReference(tx),
        authorId: author.id,
        authorVisibleToReviewer,
      },
      select: { id: true },
    });
    await tx.activityLog.create({
      data: {
        action: "submission.create_draft",
        entityType: "Submission",
        entityId: created.id,
        actorId: author.id,
        actorRole: author.role,
      },
    });
    return created;
  });

  return { ok: true, id: submission.id };
}

export type UpdateDraftResult =
  { ok: true } | { ok: false; reason: "unknown_document_type" | "not_editable" };

/** Details can change only while the submission is still a draft. */
export async function updateDraft(
  authorId: string,
  submissionId: string,
  details: SubmissionDetails,
): Promise<UpdateDraftResult> {
  if (!(await documentTypeExists(details.documentTypeId))) {
    return { ok: false, reason: "unknown_document_type" };
  }
  const { count } = await db.submission.updateMany({
    where: { id: submissionId, authorId, status: "DRAFT" },
    data: details,
  });
  return count === 1 ? { ok: true } : { ok: false, reason: "not_editable" };
}

// ── The document ───────────────────────────────────────────────────────────

function findOwnDraft(authorId: string, submissionId: string) {
  return db.submission.findFirst({
    where: { id: submissionId, authorId, status: "DRAFT" },
    select: { id: true },
  });
}

const KEY_PATTERN =
  /^submissions\/([0-9a-f-]{36})\/original\/[0-9a-f-]{36}\.(pdf|docx|doc|txt|rtf)$/;

export type PrepareUploadResult =
  | { ok: true; url: string; key: string; mimeType: string }
  | { ok: false; reason: FileRejection | "not_editable" };

/**
 * Step one of an upload: checks what the browser says about the file and, if
 * it is acceptable, issues a short-lived URL the browser can PUT it to.
 */
export async function prepareUpload(
  authorId: string,
  submissionId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<PrepareUploadResult> {
  if (!(await findOwnDraft(authorId, submissionId))) return { ok: false, reason: "not_editable" };

  const check = checkDeclaredFile(file, env.MAX_UPLOAD_BYTES);
  if (!check.ok) return check;

  // The key is ours, never the uploader's filename: a name is attacker-chosen
  // text, and it is also personal data that does not belong in a URL.
  const key = `submissions/${submissionId}/original/${randomUUID()}.${extensionOf(file.filename)}`;
  const url = await storage().presignUpload({
    key,
    contentType: check.mimeType,
    sizeBytes: file.sizeBytes,
  });
  return { ok: true, url, key, mimeType: check.mimeType };
}

export type ConfirmUploadResult =
  { ok: true } | { ok: false; reason: FileRejection | "not_editable" | "not_uploaded" };

/**
 * Step two: the browser says the upload finished. Nothing it says is taken
 * on trust — the object is fetched and its real size and leading bytes are
 * checked before it is recorded. A file that fails is deleted.
 *
 * A draft has one document; attaching another replaces it.
 */
export async function confirmUpload(
  author: SessionUser,
  submissionId: string,
  key: string,
  originalFilename: string,
): Promise<ConfirmUploadResult> {
  if (!(await findOwnDraft(author.id, submissionId))) return { ok: false, reason: "not_editable" };

  // The key must be one this submission could have been issued, or a caller
  // could attach somebody else's object to their own draft.
  const match = KEY_PATTERN.exec(key);
  if (!match || match[1] !== submissionId) return { ok: false, reason: "not_uploaded" };
  const kind = match[2] as DocumentKind;

  const info = await storage().head(key);
  if (!info) return { ok: false, reason: "not_uploaded" };
  if (info.sizeBytes > env.MAX_UPLOAD_BYTES) {
    await storage().delete(key);
    return { ok: false, reason: "too_large" };
  }

  const bytes = await storage().read(key);
  const content = checkFileContent(kind, bytes, env.MAX_UPLOAD_BYTES);
  if (!content.ok) {
    await storage().delete(key);
    return content;
  }

  const declared = checkDeclaredFile(
    { filename: `file.${kind}`, mimeType: info.contentType ?? "", sizeBytes: bytes.length },
    env.MAX_UPLOAD_BYTES,
  );
  const mimeType = declared.ok ? declared.mimeType : "application/octet-stream";

  const replaced = await db.$transaction(async (tx) => {
    const previous = await tx.storedFile.findMany({
      where: { submissionId, kind: "ORIGINAL" },
      select: { id: true, storageKey: true },
    });
    await tx.storedFile.deleteMany({ where: { id: { in: previous.map((file) => file.id) } } });
    await tx.storedFile.create({
      data: {
        submissionId,
        kind: "ORIGINAL",
        storageKey: key,
        originalFilename: originalFilename.slice(0, 255),
        mimeType,
        sizeBytes: bytes.length,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        uploadedById: author.id,
      },
    });
    // Touch the draft so it sorts as recently worked on.
    await tx.submission.update({ where: { id: submissionId }, data: { updatedAt: new Date() } });
    return previous;
  });

  // After the transaction: if this fails the row is already gone and the
  // object is merely orphaned, which is harmless and cleaned up later.
  await Promise.allSettled(replaced.map((file) => storage().delete(file.storageKey)));

  return { ok: true };
}

/** A short-lived link to download the author's own document, or null. */
export async function ownDocumentDownloadUrl(
  authorId: string,
  submissionId: string,
): Promise<string | null> {
  const file = await db.storedFile.findFirst({
    where: { kind: "ORIGINAL", submission: { id: submissionId, authorId } },
    orderBy: { createdAt: "desc" },
    select: { storageKey: true, originalFilename: true },
  });
  if (!file) return null;
  return storage().presignDownload({ key: file.storageKey, filename: file.originalFilename });
}

// ── Submitting and withdrawing ─────────────────────────────────────────────

export type SubmitResult = { ok: true } | { ok: false; reason: TransitionFailure | "no_document" };

export async function submitDraft(
  author: SessionUser,
  submissionId: string,
  ip?: string | null,
): Promise<SubmitResult> {
  const hasDocument = await db.storedFile.count({
    where: { kind: "ORIGINAL", submission: { id: submissionId, authorId: author.id } },
  });
  if (hasDocument === 0) {
    const exists = await db.submission.count({ where: { id: submissionId, authorId: author.id } });
    return { ok: false, reason: exists ? "no_document" : "not_found" };
  }

  const result = await transition({ submissionId, event: "submit", actor: author, ip });
  return result.ok ? { ok: true } : result;
}

/** Withdraws a draft, or a submission nobody has been asked to read yet. */
export async function withdrawSubmission(
  author: SessionUser,
  submissionId: string,
  ip?: string | null,
): Promise<{ ok: true } | { ok: false; reason: TransitionFailure }> {
  const result = await transition({ submissionId, event: "cancel", actor: author, ip });
  return result.ok ? { ok: true } : result;
}
