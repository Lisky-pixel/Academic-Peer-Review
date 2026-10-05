// @vitest-environment node
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { assignReviewer, reassignReviewer, setAuthorVisibility } from "@/lib/assignments";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toReviewerQueueItemDTO, toReviewerSubmissionDTO } from "@/lib/dto/review";
import { toUserSubmissionDTO } from "@/lib/dto/submission";
import type { Role } from "@/lib/generated/prisma/client";
import {
  acceptAssignment,
  confirmAnnotatedUpload,
  declineAssignment,
  findReviewerQueue,
  findReviewerSubmission,
  findTemplateFor,
  prepareAnnotatedUpload,
  reviewerFileUrl,
  saveReviewDraft,
  submitReview,
} from "@/lib/reviews";
import { findDocumentPreview } from "@/lib/reviews/preview";
import { storage } from "@/lib/storage";
import {
  createDraft,
  findOwnSubmission,
  findSubmissionsForAdmin,
  submitDraft,
} from "@/lib/submissions";
import { dbAvailable, purgeUsers, testEmail } from "@/lib/test/db";

const storageAvailable: boolean = dbAvailable
  ? await storage()
      .head("connectivity-check")
      .then(
        () => true,
        () => {
          console.warn("\n⚠ Object storage is not reachable — review tests are being SKIPPED.\n");
          return false;
        },
      )
  : false;

const REVIEWER_NAME = "Zebediah Quillfeather";
const AUTHOR_NAME = "Ottoline Brackenridge";
const DAY = 86_400_000;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A Word file the reviewer annotated, with their name where Word puts it. */
function annotatedDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
    "docProps/core.xml": strToU8(
      `<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:creator>${REVIEWER_NAME}</dc:creator><cp:lastModifiedBy>${REVIEWER_NAME}</cp:lastModifiedBy></cp:coreProperties>`,
    ),
    "word/document.xml": strToU8(
      `<w:document ${W}><w:body><w:p><w:ins w:id="1" w:author="${REVIEWER_NAME}"><w:r><w:t>drawn to</w:t></w:r></w:ins></w:p></w:body></w:document>`,
    ),
    "word/comments.xml": strToU8(
      `<w:comments ${W}><w:comment w:id="0" w:author="${REVIEWER_NAME}" w:initials="ZQ"><w:p><w:r><w:t>Start here.</w:t></w:r></w:p></w:comment></w:comments>`,
    ),
  });
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const createdUserIds: string[] = [];
const uploadedKeys: string[] = [];

async function createUser(role: Role, name: string): Promise<SessionUser> {
  const user = await db.user.create({
    data: { email: testEmail(role.toLowerCase()), name, role },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  createdUserIds.push(user.id);
  return user;
}

const documentTypeId = dbAvailable
  ? (await db.documentType.findFirstOrThrow({ where: { slug: "personal-statement" } })).id
  : "";

/** A submission assigned to `reviewer`, with a real text document in storage. */
async function assignedSubmission(options: { authorFilename?: string } = {}) {
  const author = await createUser("USER", AUTHOR_NAME);
  const admin = await createUser("ADMIN", "Test Admin");
  const reviewer = await createUser("REVIEWER", REVIEWER_NAME);

  const draft = await createDraft(author, {
    title: "Personal statement",
    documentTypeId,
    purpose: "MSc application",
    description: null,
    instructions: "4,000 characters maximum.",
    focusAreas: null,
    deadline: new Date(Date.now() + 10 * DAY),
  });
  if (!draft.ok) throw new Error("draft failed");
  const id = draft.id;

  const key = `submissions/${id}/original/00000000-0000-7000-8000-${id.slice(-12)}.txt`;
  await storage().write(key, strToU8("At sixteen I counted buses.\n"), "text/plain");
  uploadedKeys.push(key);
  await db.storedFile.create({
    data: {
      submissionId: id,
      kind: "ORIGINAL",
      storageKey: key,
      originalFilename: options.authorFilename ?? "Ottoline Brackenridge statement.txt",
      mimeType: "text/plain",
      sizeBytes: 28,
      checksum: "0".repeat(64),
      uploadedById: author.id,
    },
  });
  await submitDraft(author, id);
  const assigned = await assignReviewer({ submissionId: id, reviewerId: reviewer.id, admin });
  if (!assigned.ok) throw new Error("assign failed");

  return { author, admin, reviewer, id };
}

async function criteriaFor(reviewerId: string, id: string) {
  const record = await findReviewerSubmission(reviewerId, id);
  const template = await findTemplateFor(record!);
  return template!.criteria;
}

/** Answers every required criterion the way its input type needs. */
async function answerEverything(reviewer: SessionUser, id: string) {
  const criteria = await criteriaFor(reviewer.id, id);
  return saveReviewDraft(
    reviewer,
    id,
    criteria.map((criterion) => ({
      criterionId: criterion.id,
      rating: criterion.inputType === "TEXT" ? null : 4,
      comment: criterion.inputType === "RATING" ? null : "Specific and clear.",
    })),
  );
}

/** The real annotated-file flow: signed URL, PUT, confirm (which scrubs). */
async function uploadAnnotated(
  reviewer: SessionUser,
  id: string,
  content: Uint8Array = annotatedDocx(),
  file = { filename: `${REVIEWER_NAME} notes FINAL.docx`, mimeType: DOCX_MIME },
) {
  const prepared = await prepareAnnotatedUpload(reviewer.id, id, {
    ...file,
    sizeBytes: content.length,
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.reason}`);
  const put = await fetch(prepared.url, {
    method: "PUT",
    headers: { "Content-Type": prepared.mimeType },
    body: new Blob([new Uint8Array(content)]),
  });
  if (!put.ok) throw new Error(`PUT failed: ${put.status}`);
  return { rawKey: prepared.key, result: await confirmAnnotatedUpload(reviewer, id, prepared.key) };
}

afterAll(async () => {
  if (!dbAvailable) return;
  const files = await db.storedFile.findMany({
    where: { submission: { authorId: { in: createdUserIds } } },
    select: { storageKey: true },
  });
  await db.adminDecision.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await db.review.deleteMany({ where: { submission: { authorId: { in: createdUserIds } } } });
  await purgeUsers(createdUserIds);
  if (storageAvailable) {
    await Promise.allSettled(
      [...uploadedKeys, ...files.map((file) => file.storageKey)].map((key) =>
        storage().delete(key),
      ),
    );
  }
});

describe.skipIf(!storageAvailable)("answering an assignment", () => {
  it("accepting moves to ACCEPTED and stamps the assignment", async () => {
    const { reviewer, id } = await assignedSubmission();

    expect(await acceptAssignment(reviewer, id)).toEqual({ ok: true });

    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    const assignment = await db.assignment.findFirstOrThrow({ where: { submissionId: id } });
    expect(assignment.status).toBe("ACCEPTED");
    expect(assignment.acceptedAt).toBeInstanceOf(Date);
  });

  it("declining returns it to the admin's queue with the reason, and frees the reviewer", async () => {
    const { reviewer, admin, id } = await assignedSubmission();

    expect(await declineAssignment(reviewer, id, "  Away that week.  ")).toEqual({ ok: true });

    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe(
      "PENDING_ASSIGNMENT",
    );
    const assignment = await db.assignment.findFirstOrThrow({ where: { submissionId: id } });
    expect(assignment).toMatchObject({
      status: "DECLINED",
      declineReason: "Away that week.",
      isActive: null,
    });
    expect((await findSubmissionsForAdmin(["PENDING_ASSIGNMENT"])).map((s) => s.id)).toContain(id);
    // No longer theirs to see.
    expect(await findReviewerSubmission(reviewer.id, id)).toBeNull();
    const notice = await db.notification.findFirst({
      where: { submissionId: id, userId: admin.id, type: "ASSIGNMENT_ANSWERED" },
    });
    expect(notice?.title).toBe("Assignment declined");
  });

  it("requires a reason to decline", async () => {
    const { reviewer, id } = await assignedSubmission();

    expect(await declineAssignment(reviewer, id, "   ")).toEqual({
      ok: false,
      reason: "reason_required",
    });
    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("ASSIGNED");
  });

  it("can be re-assigned after a decline, to the same reviewer or another", async () => {
    const { reviewer, admin, id } = await assignedSubmission();
    await declineAssignment(reviewer, id, "Away.");

    expect(await assignReviewer({ submissionId: id, reviewerId: reviewer.id, admin })).toEqual({
      ok: true,
    });
    expect(await db.assignment.count({ where: { submissionId: id } })).toBe(2);
    expect(await db.assignment.count({ where: { submissionId: id, isActive: true } })).toBe(1);
  });

  it("gives another reviewer no access at all", async () => {
    const { id } = await assignedSubmission();
    const stranger = await createUser("REVIEWER", "Other Reviewer");

    expect(await findReviewerSubmission(stranger.id, id)).toBeNull();
    expect(await acceptAssignment(stranger, id)).toEqual({ ok: false, reason: "not_yours" });
    expect(await declineAssignment(stranger, id, "Not mine")).toEqual({
      ok: false,
      reason: "not_yours",
    });
    expect(await saveReviewDraft(stranger, id, [])).toEqual({ ok: false, reason: "not_editable" });
    expect(await reviewerFileUrl(stranger.id, id, "original")).toBeNull();
    expect(await findDocumentPreview(stranger.id, id)).toEqual({ type: "none" });
  });
});

describe.skipIf(!storageAvailable)("writing the review", () => {
  it("cannot be written before the assignment is accepted", async () => {
    const { reviewer, id } = await assignedSubmission();

    expect(await saveReviewDraft(reviewer, id, [])).toEqual({ ok: false, reason: "not_editable" });
    expect(await db.review.count({ where: { submissionId: id } })).toBe(0);
  });

  it("starts the review on the first save, pinned to the active template", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    const criteria = await criteriaFor(reviewer.id, id);

    const result = await saveReviewDraft(reviewer, id, [
      { criterionId: criteria[0]!.id, rating: 3, comment: "A few slips." },
    ]);

    expect(result).toEqual({ ok: true });
    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("IN_REVIEW");
    const review = await db.review.findFirstOrThrow({
      where: { submissionId: id },
      include: { responses: true, template: true },
    });
    expect(review.status).toBe("DRAFT");
    expect(review.template.isActive).toBe(true);
    expect(review.responses).toHaveLength(1);
    expect(review.responses[0]).toMatchObject({ rating: 3, comment: "A few slips." });
  });

  it("autosaves partial changes without disturbing other answers", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    const [first, second] = await criteriaFor(reviewer.id, id);

    await saveReviewDraft(reviewer, id, [{ criterionId: first!.id, rating: 2, comment: "One" }]);
    await saveReviewDraft(reviewer, id, [{ criterionId: second!.id, rating: 5, comment: "Two" }]);
    await saveReviewDraft(reviewer, id, [{ criterionId: first!.id, rating: 4, comment: "Edited" }]);

    const dto = toReviewerSubmissionDTO(
      (await findReviewerSubmission(reviewer.id, id))!,
      await findTemplateFor((await findReviewerSubmission(reviewer.id, id))!),
      reviewer.id,
    );
    expect(dto.answers[first!.id]).toEqual({ rating: 4, comment: "Edited" });
    expect(dto.answers[second!.id]).toEqual({ rating: 5, comment: "Two" });
    // One review, however many saves.
    expect(await db.review.count({ where: { submissionId: id } })).toBe(1);
  });

  it("ignores answers for criteria that belong to a different template", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    const foreign = await db.reviewCriterion.findFirstOrThrow({
      where: { template: { documentType: { slug: "essay" } } },
    });

    await saveReviewDraft(reviewer, id, [{ criterionId: foreign.id, rating: 5, comment: "Hi" }]);

    expect(await db.reviewResponse.count({ where: { review: { submissionId: id } } })).toBe(0);
  });

  it("keeps a review's questions fixed when the template is replaced mid-review", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    const before = await criteriaFor(reviewer.id, id);
    await saveReviewDraft(reviewer, id, [{ criterionId: before[0]!.id, rating: 3, comment: "" }]);

    const pinned = (await db.review.findFirstOrThrow({ where: { submissionId: id } })).templateId;
    // Simulate an admin publishing version 2: retire v1, add v2.
    await db.reviewTemplate.update({ where: { id: pinned }, data: { isActive: null } });
    const v2 = await db.reviewTemplate.create({
      data: {
        documentTypeId,
        name: "Personal Statement review",
        version: 900 + Math.floor(Math.random() * 99),
        isActive: true,
        criteria: { create: [{ label: "A brand new question", sortOrder: 0 }] },
      },
    });

    try {
      const after = await criteriaFor(reviewer.id, id);
      expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
      expect(after.map((c) => c.label)).not.toContain("A brand new question");
    } finally {
      await db.reviewTemplate.delete({ where: { id: v2.id } });
      await db.reviewTemplate.update({ where: { id: pinned }, data: { isActive: true } });
    }
  });
});

describe.skipIf(!storageAvailable)("the annotated file", () => {
  it("stores only a scrubbed copy, under a name built from the reference", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);

    const { rawKey, result } = await uploadAnnotated(reviewer, id);

    expect(result).toEqual({ ok: true });
    const file = await db.storedFile.findFirstOrThrow({
      where: { submissionId: id, kind: "ANNOTATED" },
    });
    const reference = (await db.submission.findUniqueOrThrow({ where: { id } })).reference;
    expect(file.originalFilename).toBe(`${reference}-reviewed.docx`);
    expect(file.scrubbedAt).toBeInstanceOf(Date);
    expect(file.uploadedById).toBe(reviewer.id);
    expect(file.storageKey).not.toBe(rawKey);
    // The reviewer's own filename is recorded nowhere.
    expect(JSON.stringify(file)).not.toContain("Quillfeather");
    // The unscrubbed upload is gone from storage.
    expect(await storage().head(rawKey)).toBeNull();
  });

  it("the stored bytes contain the reviewer's name nowhere", async () => {
    // Verification step 6 of the plan: unzip what would be downloaded and look.
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    await uploadAnnotated(reviewer, id);

    const response = await fetch((await reviewerFileUrl(reviewer.id, id, "annotated"))!);
    const parts = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const everything = Object.values(parts)
      .map((part) => strFromU8(part))
      .join("\n");

    expect(everything).not.toContain(REVIEWER_NAME);
    expect(everything).not.toContain("Quillfeather");
    expect(everything).toContain('w:author="Reviewer"');
    expect(everything).toContain("<dc:creator>Reviewer</dc:creator>");
    expect(everything).toContain("Start here.");
    expect(response.headers.get("content-disposition")).toMatch(/RF-\d{4}-\d+-reviewed\.docx/);
  });

  it.each([
    ["a legacy .doc", "notes.doc", "application/msword"],
    ["an .rtf", "notes.rtf", "application/rtf"],
    ["an image", "scan.png", "image/png"],
  ])("refuses %s, which cannot be reliably scrubbed", async (_label, filename, mimeType) => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);

    expect(
      await prepareAnnotatedUpload(reviewer.id, id, { filename, mimeType, sizeBytes: 100 }),
    ).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("rejects a file that cannot be scrubbed, and keeps neither copy", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    // A real zip, but not a Word document.
    const notWord = zipSync({ "readme.txt": strToU8("hello") });

    const { rawKey, result } = await uploadAnnotated(reviewer, id, notWord);

    expect(result).toEqual({ ok: false, reason: "unreadable" });
    expect(await db.storedFile.count({ where: { submissionId: id, kind: "ANNOTATED" } })).toBe(0);
    expect(await storage().head(rawKey)).toBeNull();
  });

  it("replaces the reviewer's earlier upload and removes the old object", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    await uploadAnnotated(reviewer, id);
    const first = await db.storedFile.findFirstOrThrow({
      where: { submissionId: id, kind: "ANNOTATED" },
    });

    await uploadAnnotated(reviewer, id);

    const files = await db.storedFile.findMany({ where: { submissionId: id, kind: "ANNOTATED" } });
    expect(files).toHaveLength(1);
    expect(files[0]!.storageKey).not.toBe(first.storageKey);
    expect(await storage().head(first.storageKey)).toBeNull();
  });

  it("cannot be uploaded before accepting, or by someone who does not hold it", async () => {
    const { reviewer, id } = await assignedSubmission();
    const stranger = await createUser("REVIEWER", "Other Reviewer");
    const file = { filename: "notes.docx", mimeType: DOCX_MIME, sizeBytes: 100 };

    expect(await prepareAnnotatedUpload(reviewer.id, id, file)).toEqual({
      ok: false,
      reason: "not_editable",
    });
    await acceptAssignment(reviewer, id);
    expect(await prepareAnnotatedUpload(stranger.id, id, file)).toEqual({
      ok: false,
      reason: "not_editable",
    });
  });
});

describe.skipIf(!storageAvailable)("submitting the review", () => {
  it("is refused while required criteria are unanswered, and says which", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    const criteria = await criteriaFor(reviewer.id, id);
    await saveReviewDraft(reviewer, id, [{ criterionId: criteria[0]!.id, rating: 4, comment: "" }]);
    await uploadAnnotated(reviewer, id);

    const result = await submitReview(reviewer, id);

    expect(result).toMatchObject({ ok: false, reason: "incomplete" });
    expect(result.ok === false && result.reason === "incomplete" && result.missing).toEqual(
      criteria.slice(1).map((criterion) => criterion.label),
    );
    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("IN_REVIEW");
  });

  it("is refused without an annotated copy", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    await answerEverything(reviewer, id);

    expect(await submitReview(reviewer, id)).toEqual({ ok: false, reason: "no_annotated_file" });
  });

  it("lands in the admin's approval queue, and locks the review", async () => {
    // The Phase 6 exit criterion.
    const { reviewer, admin, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    await answerEverything(reviewer, id);
    await uploadAnnotated(reviewer, id);

    expect(await submitReview(reviewer, id, "203.0.113.4")).toEqual({ ok: true });

    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe(
      "UNDER_ADMIN_REVIEW",
    );
    expect((await findSubmissionsForAdmin(["UNDER_ADMIN_REVIEW"])).map((s) => s.id)).toContain(id);
    const review = await db.review.findFirstOrThrow({ where: { submissionId: id } });
    expect(review.status).toBe("SUBMITTED");
    expect(review.submittedAt).toBeInstanceOf(Date);
    const notice = await db.notification.findFirst({
      where: { submissionId: id, userId: admin.id, type: "REVIEW_SUBMITTED" },
    });
    expect(notice).not.toBeNull();

    // Read-only from here.
    const criteria = await criteriaFor(reviewer.id, id);
    expect(
      await saveReviewDraft(reviewer, id, [
        { criterionId: criteria[0]!.id, rating: 1, comment: "" },
      ]),
    ).toEqual({ ok: false, reason: "not_editable" });
    expect(await submitReview(reviewer, id)).toEqual({ ok: false, reason: "not_editable" });
    expect(
      await prepareAnnotatedUpload(reviewer.id, id, {
        filename: "again.docx",
        mimeType: DOCX_MIME,
        sizeBytes: 10,
      }),
    ).toEqual({ ok: false, reason: "not_editable" });
  });

  it("shows up in the reviewer's queue in the right place at each step", async () => {
    const { reviewer, id } = await assignedSubmission();
    const bucket = async () =>
      (await findReviewerQueue(reviewer.id))
        .map((record) => toReviewerQueueItemDTO(record))
        .find((item) => item?.submissionId === id)?.bucket;

    expect(await bucket()).toBe("pending");
    await acceptAssignment(reviewer, id);
    expect(await bucket()).toBe("active");
    await answerEverything(reviewer, id);
    await uploadAnnotated(reviewer, id);
    await submitReview(reviewer, id);
    expect(await bucket()).toBe("completed");
  });

  it("flags an unfinished review past its due date as overdue, but not a submitted one", async () => {
    const { reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    await db.assignment.updateMany({
      where: { submissionId: id },
      data: { dueAt: new Date(Date.now() - DAY) },
    });
    const item = async () =>
      (await findReviewerQueue(reviewer.id))
        .map((record) => toReviewerQueueItemDTO(record))
        .find((entry) => entry?.submissionId === id);

    expect((await item())?.overdue).toBe(true);
    await answerEverything(reviewer, id);
    await uploadAnnotated(reviewer, id);
    await submitReview(reviewer, id);
    expect((await item())?.overdue).toBe(false);
  });

  it("a reviewer it was taken from can no longer write or submit", async () => {
    const { reviewer, admin, id } = await assignedSubmission();
    const replacement = await createUser("REVIEWER", "Replacement Reviewer");
    await acceptAssignment(reviewer, id);
    await answerEverything(reviewer, id);
    await uploadAnnotated(reviewer, id);

    await reassignReviewer({
      submissionId: id,
      reviewerId: replacement.id,
      admin,
      reason: "Leave.",
    });

    expect(await submitReview(reviewer, id)).toEqual({ ok: false, reason: "not_editable" });
    expect(await findReviewerSubmission(reviewer.id, id)).toBeNull();
    // The replacement starts clean: they do not inherit the first reviewer's
    // answers or their annotated file.
    const dto = toReviewerSubmissionDTO(
      (await findReviewerSubmission(replacement.id, id))!,
      await findTemplateFor((await findReviewerSubmission(replacement.id, id))!),
      replacement.id,
    );
    expect(dto.answers).toEqual({});
    expect(dto.annotated).toBeNull();
    expect(await reviewerFileUrl(replacement.id, id, "annotated")).toBeNull();
  });
});

describe.skipIf(!storageAvailable)("anonymity in the reviewer's workspace", () => {
  async function workspace(reviewer: SessionUser, id: string) {
    const record = (await findReviewerSubmission(reviewer.id, id))!;
    return toReviewerSubmissionDTO(record, await findTemplateFor(record), reviewer.id);
  }

  it("shows the author's name when the admin allows it", async () => {
    const { reviewer, admin, id } = await assignedSubmission();
    const visible = (await db.submission.findUniqueOrThrow({ where: { id } }))
      .authorVisibleToReviewer;
    if (!visible) await setAuthorVisibility(id, true, admin);

    const dto = await workspace(reviewer, id);

    expect(dto.authorName).toBe(AUTHOR_NAME);
    expect(dto.document?.filename).toBe("Ottoline Brackenridge statement.txt");
  });

  it("hides the author everywhere when the admin switches visibility off", async () => {
    const { author, reviewer, admin, id } = await assignedSubmission();
    const visible = (await db.submission.findUniqueOrThrow({ where: { id } }))
      .authorVisibleToReviewer;
    if (visible) await setAuthorVisibility(id, false, admin);

    const dto = await workspace(reviewer, id);
    const queue = (await findReviewerQueue(reviewer.id)).map((record) =>
      toReviewerQueueItemDTO(record),
    );
    const everything = JSON.stringify({ dto, queue });

    expect(dto.authorName).toBeNull();
    expect(everything).not.toContain(AUTHOR_NAME);
    expect(everything).not.toContain("Brackenridge");
    expect(everything).not.toContain(author.email);
    expect(everything).not.toContain(author.id);
    // Including the filename, which is very often the author's own name.
    const reference = (await db.submission.findUniqueOrThrow({ where: { id } })).reference;
    expect(dto.document?.filename).toBe(`${reference}.txt`);
    const download = await fetch((await reviewerFileUrl(reviewer.id, id, "original"))!);
    expect(download.headers.get("content-disposition")).toContain(`${reference}.txt`);
    expect(download.headers.get("content-disposition")).not.toContain("Brackenridge");
  });

  it("never gives the reviewer the author's email, even when the name is visible", async () => {
    const { author, reviewer, admin, id } = await assignedSubmission();
    await setAuthorVisibility(id, true, admin);

    expect(JSON.stringify(await workspace(reviewer, id))).not.toContain(author.email);
  });

  it("still tells the author nothing about the reviewer after a full review", async () => {
    const { author, reviewer, id } = await assignedSubmission();
    await acceptAssignment(reviewer, id);
    await answerEverything(reviewer, id);
    await uploadAnnotated(reviewer, id);
    await submitReview(reviewer, id);

    const dto = toUserSubmissionDTO((await findOwnSubmission(author.id, id))!);
    const notifications = await db.notification.findMany({
      where: { submissionId: id, userId: author.id },
    });
    const everything = JSON.stringify({ dto, notifications });

    expect(everything).not.toContain(REVIEWER_NAME);
    expect(everything).not.toContain(reviewer.email);
    expect(everything).not.toContain(reviewer.id);
    expect(dto.stage).toBe("final_checks");
    // The author's own document is the only file they are offered so far.
    expect(dto.document?.filename).toBe("Ottoline Brackenridge statement.txt");
  });
});

describe.skipIf(!storageAvailable)("document preview", () => {
  it("returns the text of a plain-text document to the reviewer who holds it", async () => {
    const { reviewer, id } = await assignedSubmission();

    expect(await findDocumentPreview(reviewer.id, id)).toEqual({
      type: "text",
      text: "At sixteen I counted buses.\n",
    });
  });
});
