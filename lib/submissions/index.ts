import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { type ScrubFailure, scrubDocument } from "@/lib/files/scrub";
import {
  checkDeclaredFile,
  checkFileContent,
  extensionOf,
  type FileRejection,
} from "@/lib/files/validate";
import type { Prisma, SubmissionStatus } from "@/lib/generated/prisma/client";
import { storage } from "@/lib/storage";
import type { PaperDetails } from "@/lib/submissions/schema";
import { transition, type TransitionFailure } from "@/lib/workflow/state-machine";

/**
 * Papers, from the submitter's side: drafting, attaching the file,
 * submitting, editing until reviewers have it, withdrawing, and reading the
 * reviews once a decision is made.
 *
 * Every function that takes an `authorId` scopes its queries to that person,
 * so "not found" and "not yours" are the same answer and ids cannot be
 * probed. Status never changes here except through `transition()`.
 */

/** A paper can be edited until it goes to reviewers. */
export const EDITABLE: SubmissionStatus[] = ["DRAFT", "SUBMITTED"];

/** The submitter sees the reviews only once there is a decision. */
export const DECIDED: SubmissionStatus[] = ["ACCEPTED", "REJECTED"];

/** Paper files: PDF and Word only, the two whose metadata can be scrubbed. */
export const PAPER_KINDS = ["pdf", "docx"] as const;

// ── Reference numbers ──────────────────────────────────────────────────────

/**
 * Allocates the next reference for the current year, e.g. "APR-2026-0147".
 * One atomic upsert on the per-year counter, so two people submitting at the
 * same instant get consecutive numbers rather than the same one.
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
  return `APR-${year}-${String(sequence).padStart(4, "0")}`;
}

// ── Conferences open for papers ────────────────────────────────────────────

export function isOpenForPapers(
  conference: { submissionsOpenAt: Date; submissionsCloseAt: Date },
  now: Date = new Date(),
): boolean {
  return conference.submissionsOpenAt <= now && now < conference.submissionsCloseAt;
}

const OPEN_CONFERENCE_SELECT = {
  id: true,
  name: true,
  description: true,
  venue: true,
  startsOn: true,
  endsOn: true,
  submissionsOpenAt: true,
  submissionsCloseAt: true,
  submissionFormat: true,
  topics: true,
  doubleBlind: true,
} satisfies Prisma.ConferenceSelect;

export type OpenConferenceRecord = Prisma.ConferenceGetPayload<{
  select: typeof OPEN_CONFERENCE_SELECT;
}>;

export function findOpenConferences(now: Date = new Date()): Promise<OpenConferenceRecord[]> {
  return db.conference.findMany({
    where: { submissionsOpenAt: { lte: now }, submissionsCloseAt: { gt: now } },
    orderBy: { submissionsCloseAt: "asc" },
    select: OPEN_CONFERENCE_SELECT,
  });
}

export function findConferenceForSubmitting(conferenceId: string) {
  return db.conference.findUnique({
    where: { id: conferenceId },
    select: OPEN_CONFERENCE_SELECT,
  });
}

export function findDisciplines() {
  return db.discipline.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

// ── Reading ────────────────────────────────────────────────────────────────

const OWN_PAPER_SELECT = {
  id: true,
  reference: true,
  title: true,
  authorNames: true,
  contactEmail: true,
  institution: true,
  topic: true,
  disciplineId: true,
  disciplineOther: true,
  discipline: { select: { name: true } },
  paperType: true,
  abstract: true,
  status: true,
  decisionNote: true,
  decidedAt: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  conference: {
    select: {
      id: true,
      name: true,
      topics: true,
      submissionFormat: true,
      submissionsOpenAt: true,
      submissionsCloseAt: true,
      doubleBlind: true,
    },
  },
  files: {
    where: { kind: "ORIGINAL" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { originalFilename: true, sizeBytes: true, createdAt: true },
  },
} satisfies Prisma.SubmissionSelect;

export type OwnPaperRecord = Prisma.SubmissionGetPayload<{ select: typeof OWN_PAPER_SELECT }>;

export function findOwnPapers(authorId: string): Promise<OwnPaperRecord[]> {
  return db.submission.findMany({
    where: { authorId },
    orderBy: { updatedAt: "desc" },
    select: OWN_PAPER_SELECT,
  });
}

export function findOwnPaper(authorId: string, paperId: string): Promise<OwnPaperRecord | null> {
  return db.submission.findFirst({
    where: { id: paperId, authorId },
    select: OWN_PAPER_SELECT,
  });
}

const OWN_REVIEWS_SELECT = {
  id: true,
  score: true,
  recommend: true,
  comments: true,
  submittedAt: true,
  files: {
    where: { kind: "ANNOTATED", scrubbedAt: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, originalFilename: true, sizeBytes: true },
  },
} satisfies Prisma.ReviewSelect;

export type OwnReviewRecord = Prisma.ReviewGetPayload<{ select: typeof OWN_REVIEWS_SELECT }>;

/**
 * The finished reviews of a paper, for its submitter, once it has been
 * decided. Nothing about who wrote them is selected.
 */
export function findOwnReviews(authorId: string, paperId: string): Promise<OwnReviewRecord[]> {
  return db.review.findMany({
    where: {
      status: "SUBMITTED",
      submission: { id: paperId, authorId, status: { in: DECIDED } },
    },
    orderBy: { submittedAt: "asc" },
    select: OWN_REVIEWS_SELECT,
  });
}

/** A download link for a reviewer's marked-up copy, for the paper's submitter. */
export async function ownReviewFileUrl(
  authorId: string,
  paperId: string,
  fileId: string,
): Promise<string | null> {
  const file = await db.storedFile.findFirst({
    where: {
      id: fileId,
      kind: "ANNOTATED",
      // Never a file whose metadata was not stripped.
      scrubbedAt: { not: null },
      review: { status: "SUBMITTED" },
      submission: { id: paperId, authorId, status: { in: DECIDED } },
    },
    select: { storageKey: true, originalFilename: true },
  });
  if (!file) return null;
  return storage().presignDownload({ key: file.storageKey, filename: file.originalFilename });
}

/** A short-lived link to download the submitter's own paper, or null. */
export async function ownPaperDownloadUrl(
  authorId: string,
  paperId: string,
): Promise<string | null> {
  const file = await db.storedFile.findFirst({
    where: { kind: "ORIGINAL", submission: { id: paperId, authorId } },
    orderBy: { createdAt: "desc" },
    select: { storageKey: true, originalFilename: true },
  });
  if (!file) return null;
  return storage().presignDownload({ key: file.storageKey, filename: file.originalFilename });
}

// ── Drafting and editing ───────────────────────────────────────────────────

export type DetailsFailure = "conference_closed" | "unknown_discipline" | "unknown_topic";

async function checkDetails(
  conference: { topics: string[] },
  details: PaperDetails,
  typedTopic: boolean,
): Promise<DetailsFailure | null> {
  if (!typedTopic && !conference.topics.includes(details.topic)) return "unknown_topic";
  if (details.disciplineId) {
    const found = await db.discipline.count({
      where: { id: details.disciplineId, isActive: true },
    });
    if (found !== 1) return "unknown_discipline";
  }
  return null;
}

export async function createDraft(
  author: SessionUser,
  conferenceId: string,
  details: PaperDetails,
  typedTopic: boolean,
): Promise<{ ok: true; id: string } | { ok: false; reason: DetailsFailure }> {
  const conference = await db.conference.findUnique({
    where: { id: conferenceId },
    select: { topics: true, submissionsOpenAt: true, submissionsCloseAt: true },
  });
  if (!conference || !isOpenForPapers(conference)) {
    return { ok: false, reason: "conference_closed" };
  }
  const problem = await checkDetails(conference, details, typedTopic);
  if (problem) return { ok: false, reason: problem };

  const paper = await db.$transaction(async (tx) => {
    const created = await tx.submission.create({
      data: {
        ...details,
        conferenceId,
        reference: await allocateReference(tx),
        authorId: author.id,
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

  return { ok: true, id: paper.id };
}

export type UpdateResult = { ok: true } | { ok: false; reason: DetailsFailure | "not_editable" };

/** Details can change until the paper goes to reviewers. */
export async function updatePaper(
  author: SessionUser,
  paperId: string,
  details: PaperDetails,
  typedTopic: boolean,
): Promise<UpdateResult> {
  const paper = await db.submission.findFirst({
    where: { id: paperId, authorId: author.id, status: { in: EDITABLE } },
    select: { conference: { select: { topics: true } } },
  });
  if (!paper) return { ok: false, reason: "not_editable" };
  const problem = await checkDetails(paper.conference, details, typedTopic);
  if (problem) return { ok: false, reason: problem };

  const { count } = await db.submission.updateMany({
    where: { id: paperId, authorId: author.id, status: { in: EDITABLE } },
    data: details,
  });
  if (count !== 1) return { ok: false, reason: "not_editable" };

  await db.activityLog.create({
    data: {
      action: "submission.edited",
      entityType: "Submission",
      entityId: paperId,
      actorId: author.id,
      actorRole: author.role,
    },
  });
  return { ok: true };
}

// ── The paper file ─────────────────────────────────────────────────────────

function findOwnEditable(authorId: string, paperId: string) {
  return db.submission.findFirst({
    where: { id: paperId, authorId, status: { in: EDITABLE } },
    select: { id: true },
  });
}

const KEY_PATTERN = /^submissions\/([0-9a-f-]{36})\/raw\/[0-9a-f-]{36}\.(pdf|docx)$/;

export type PrepareUploadResult =
  | { ok: true; url: string; key: string; mimeType: string }
  | { ok: false; reason: FileRejection | "not_editable" };

/**
 * Step one of an upload: checks what the browser says about the file and, if
 * it is acceptable, issues a short-lived URL the browser can PUT it to.
 */
export async function prepareUpload(
  authorId: string,
  paperId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<PrepareUploadResult> {
  if (!(await findOwnEditable(authorId, paperId))) return { ok: false, reason: "not_editable" };

  const check = checkDeclaredFile(file, env.MAX_UPLOAD_BYTES);
  if (!check.ok) return check;
  if (!(PAPER_KINDS as readonly string[]).includes(check.kind)) {
    return { ok: false, reason: "unsupported_type" };
  }

  const key = `submissions/${paperId}/raw/${randomUUID()}.${extensionOf(file.filename)}`;
  const url = await storage().presignUpload({
    key,
    contentType: check.mimeType,
    sizeBytes: file.sizeBytes,
  });
  return { ok: true, url, key, mimeType: check.mimeType };
}

export type ConfirmUploadResult =
  | { ok: true }
  | { ok: false; reason: FileRejection | ScrubFailure | "not_editable" | "not_uploaded" };

/**
 * Step two: the browser says the upload finished. The object is fetched and
 * its real size and leading bytes are checked; then the names in its
 * metadata (document author, last editor, tracked-change authors) are
 * replaced with "Author" and only that scrubbed copy is kept. The raw upload
 * is deleted whatever happens.
 *
 * A paper has one file; attaching another replaces it.
 */
export async function confirmUpload(
  author: SessionUser,
  paperId: string,
  rawKey: string,
  originalFilename: string,
): Promise<ConfirmUploadResult> {
  const match = KEY_PATTERN.exec(rawKey);
  if (!match || match[1] !== paperId) return { ok: false, reason: "not_uploaded" };
  const kind = match[2] as (typeof PAPER_KINDS)[number];

  try {
    if (!(await findOwnEditable(author.id, paperId))) return { ok: false, reason: "not_editable" };

    const info = await storage().head(rawKey);
    if (!info) return { ok: false, reason: "not_uploaded" };
    if (info.sizeBytes > env.MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };

    const raw = await storage().read(rawKey);
    const content = checkFileContent(kind, raw, env.MAX_UPLOAD_BYTES);
    if (!content.ok) return content;

    const scrubbed = await scrubDocument(kind, raw, "Author");
    if (!scrubbed.ok) return scrubbed;

    const declared = checkDeclaredFile(
      { filename: `file.${kind}`, mimeType: info.contentType ?? "", sizeBytes: raw.length },
      env.MAX_UPLOAD_BYTES,
    );
    const mimeType = declared.ok ? declared.mimeType : "application/octet-stream";
    const key = `submissions/${paperId}/paper/${randomUUID()}.${kind}`;
    await storage().write(key, scrubbed.bytes, mimeType);

    const replaced = await db.$transaction(async (tx) => {
      const previous = await tx.storedFile.findMany({
        where: { submissionId: paperId, kind: "ORIGINAL" },
        select: { id: true, storageKey: true },
      });
      await tx.storedFile.deleteMany({ where: { id: { in: previous.map((file) => file.id) } } });
      await tx.storedFile.create({
        data: {
          submissionId: paperId,
          kind: "ORIGINAL",
          storageKey: key,
          originalFilename: originalFilename.slice(0, 255),
          mimeType,
          sizeBytes: scrubbed.bytes.length,
          checksum: createHash("sha256").update(scrubbed.bytes).digest("hex"),
          uploadedById: author.id,
          scrubbedAt: new Date(),
        },
      });
      await tx.submission.update({ where: { id: paperId }, data: { updatedAt: new Date() } });
      return previous;
    });
    await Promise.allSettled(replaced.map((file) => storage().delete(file.storageKey)));

    return { ok: true };
  } finally {
    await storage()
      .delete(rawKey)
      .catch(() => undefined);
  }
}

// ── Submitting and withdrawing ─────────────────────────────────────────────

export type SubmitFailure =
  TransitionFailure | "no_file" | "no_declaration" | "conference_closed" | "limit_reached";

export async function submitPaper(
  author: SessionUser,
  paperId: string,
  declared: boolean,
  ip?: string | null,
): Promise<{ ok: true } | { ok: false; reason: SubmitFailure }> {
  const paper = await db.submission.findFirst({
    where: { id: paperId, authorId: author.id },
    select: {
      conferenceId: true,
      conference: {
        select: {
          submissionFormat: true,
          submissionLimit: true,
          submissionsOpenAt: true,
          submissionsCloseAt: true,
        },
      },
      _count: { select: { files: { where: { kind: "ORIGINAL" } } } },
    },
  });
  if (!paper) return { ok: false, reason: "not_found" };
  if (!isOpenForPapers(paper.conference)) return { ok: false, reason: "conference_closed" };
  if (paper.conference.submissionFormat === "FULL_PAPER" && paper._count.files === 0) {
    return { ok: false, reason: "no_file" };
  }
  if (!declared) return { ok: false, reason: "no_declaration" };

  const limit = paper.conference.submissionLimit;
  if (limit !== null) {
    const used = await db.submission.count({
      where: {
        conferenceId: paper.conferenceId,
        status: { notIn: ["DRAFT", "WITHDRAWN"] },
      },
    });
    if (used >= limit) return { ok: false, reason: "limit_reached" };
  }

  const result = await transition({
    submissionId: paperId,
    event: "submit",
    actor: author,
    ip,
    apply: async (tx) => {
      await tx.submission.update({
        where: { id: paperId },
        data: { declarationAt: new Date() },
      });
    },
  });
  return result.ok ? { ok: true } : result;
}

/** Withdraws a draft, or a paper reviewers do not have yet. */
export async function withdrawPaper(
  author: SessionUser,
  paperId: string,
  ip?: string | null,
): Promise<{ ok: true } | { ok: false; reason: TransitionFailure }> {
  const owns = await db.submission.count({ where: { id: paperId, authorId: author.id } });
  if (owns !== 1) return { ok: false, reason: "not_found" };
  const result = await transition({ submissionId: paperId, event: "withdraw", actor: author, ip });
  return result.ok ? { ok: true } : result;
}
