// @vitest-environment node
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import {
  adminAnnotatedDownloadUrl,
  approveReview,
  findOwnReview,
  findReviewForAdmin,
  markDelivered,
  ownReviewedFileUrl,
  requestRevision,
} from "@/lib/approvals";
import {
  assignReviewer,
  findReviewersWithWorkload,
  findSubmissionActivity,
} from "@/lib/assignments";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toAdminReviewDTO, toUserReviewDTO } from "@/lib/dto/approval";
import { toActivityDTO } from "@/lib/dto/assignment";
import { toReviewerSubmissionDTO } from "@/lib/dto/review";
import { toUserSubmissionDTO } from "@/lib/dto/submission";
import type { Role } from "@/lib/generated/prisma/client";
import {
  acceptAssignment,
  confirmAnnotatedUpload,
  findReviewerSubmission,
  findTemplateFor,
  prepareAnnotatedUpload,
  saveReviewDraft,
  submitReview,
} from "@/lib/reviews";
import { storage } from "@/lib/storage";
import { createDraft, findOwnSubmission, submitDraft } from "@/lib/submissions";
import { dbAvailable, purgeUsers, testEmail } from "@/lib/test/db";

const storageAvailable: boolean = dbAvailable
  ? await storage()
      .head("connectivity-check")
      .then(
        () => true,
        () => {
          console.warn("\n⚠ Object storage is not reachable — approval tests are being SKIPPED.\n");
          return false;
        },
      )
  : false;

const REVIEWER_NAME = "Zebediah Quillfeather";
const ADMIN_NAME = "Perpetua Hollingsworth";
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REVISION_NOTE = "Be specific about the second paragraph, please.";

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

async function answerEverything(
  reviewer: SessionUser,
  id: string,
  comment = "Specific and clear.",
) {
  const record = (await findReviewerSubmission(reviewer.id, id))!;
  const template = (await findTemplateFor(record))!;
  await saveReviewDraft(
    reviewer,
    id,
    template.criteria.map((criterion) => ({
      criterionId: criterion.id,
      rating: criterion.inputType === "TEXT" ? null : 4,
      comment: criterion.inputType === "RATING" ? null : comment,
    })),
  );
}

async function uploadAnnotated(reviewer: SessionUser, id: string) {
  const content = annotatedDocx();
  const prepared = await prepareAnnotatedUpload(reviewer.id, id, {
    filename: `${REVIEWER_NAME} notes.docx`,
    mimeType: DOCX_MIME,
    sizeBytes: content.length,
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.reason}`);
  await fetch(prepared.url, {
    method: "PUT",
    headers: { "Content-Type": prepared.mimeType },
    body: new Blob([new Uint8Array(content)]),
  });
  const confirmed = await confirmAnnotatedUpload(reviewer, id, prepared.key);
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.reason}`);
}

/** A submission whose review has been submitted and is waiting for the admin. */
async function reviewAwaitingApproval() {
  const author = await createUser("USER", "Test Author");
  const admin = await createUser("ADMIN", ADMIN_NAME);
  const reviewer = await createUser("REVIEWER", REVIEWER_NAME);

  const draft = await createDraft(author, {
    title: "Personal statement",
    documentTypeId,
    purpose: null,
    description: null,
    instructions: null,
    focusAreas: null,
    deadline: null,
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
      originalFilename: "statement.txt",
      mimeType: "text/plain",
      sizeBytes: 28,
      checksum: "0".repeat(64),
      uploadedById: author.id,
    },
  });
  await submitDraft(author, id);
  await assignReviewer({ submissionId: id, reviewerId: reviewer.id, admin });
  await acceptAssignment(reviewer, id);
  await answerEverything(reviewer, id);
  await uploadAnnotated(reviewer, id);
  const submitted = await submitReview(reviewer, id);
  if (!submitted.ok) throw new Error(`submit failed: ${submitted.reason}`);

  return { author, admin, reviewer, id };
}

const statusOf = async (id: string) =>
  (await db.submission.findUniqueOrThrow({ where: { id } })).status;

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

describe.skipIf(!storageAvailable)("the administrator reading a review", () => {
  it("sees who wrote it, every answer, and both documents", async () => {
    const { id } = await reviewAwaitingApproval();

    const review = toAdminReviewDTO((await findReviewForAdmin(id))!)!;

    expect(review).toMatchObject({ reviewerName: REVIEWER_NAME, round: 0, awaitingDecision: true });
    expect(review.criteria.length).toBeGreaterThanOrEqual(5);
    expect(review.criteria.every((c) => c.rating === 4 || c.comment)).toBe(true);
    expect(review.original?.filename).toBe("statement.txt");
    expect(review.annotated?.filename).toMatch(/^RF-\d{4}-\d+-reviewed\.docx$/);
    expect(await adminAnnotatedDownloadUrl(id)).toContain("annotated");
  });

  it("is shown nothing before a review exists", async () => {
    const author = await createUser("USER", "Early Author");
    const draft = await createDraft(author, {
      title: "Not reviewed",
      documentTypeId,
      purpose: null,
      description: null,
      instructions: null,
      focusAreas: null,
      deadline: null,
    });
    if (!draft.ok) throw new Error("draft failed");

    expect(await findReviewForAdmin(draft.id)).toBeNull();
    expect(await adminAnnotatedDownloadUrl(draft.id)).toBeNull();
  });
});

describe.skipIf(!storageAvailable)("approving", () => {
  it("releases the review: APPROVED, a decision on record, the assignment completed", async () => {
    const { author, admin, reviewer, id } = await reviewAwaitingApproval();

    expect(await approveReview(admin, id, "", "203.0.113.5")).toEqual({ ok: true });

    const submission = await db.submission.findUniqueOrThrow({ where: { id } });
    expect(submission.status).toBe("APPROVED");
    expect(submission.approvedAt).toBeInstanceOf(Date);

    const decision = await db.adminDecision.findFirstOrThrow({
      where: { review: { submissionId: id } },
    });
    expect(decision).toMatchObject({ adminId: admin.id, decision: "APPROVED" });

    const assignment = await db.assignment.findFirstOrThrow({ where: { submissionId: id } });
    expect(assignment.status).toBe("COMPLETED");
    expect(assignment.completedAt).toBeInstanceOf(Date);
    // A finished review no longer counts towards the reviewer's workload.
    const workload = (await findReviewersWithWorkload()).find((r) => r.id === reviewer.id);
    expect(workload?.activeCount).toBe(0);

    const notice = await db.notification.findFirst({
      where: { submissionId: id, userId: author.id, type: "REVIEW_READY" },
    });
    expect(notice).not.toBeNull();
  });

  it("can only be done by an administrator", async () => {
    const { author, reviewer, id } = await reviewAwaitingApproval();

    for (const actor of [author, reviewer]) {
      expect(await approveReview(actor, id)).toEqual({ ok: false, reason: "role_not_allowed" });
    }
    expect(await statusOf(id)).toBe("UNDER_ADMIN_REVIEW");
    expect(await db.adminDecision.count({ where: { review: { submissionId: id } } })).toBe(0);
  });

  it("cannot be done twice, and a double click leaves one decision", async () => {
    const { admin, id } = await reviewAwaitingApproval();

    const results = await Promise.all([approveReview(admin, id), approveReview(admin, id)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.adminDecision.count({ where: { review: { submissionId: id } } })).toBe(1);
    expect(await approveReview(admin, id)).toEqual({
      ok: false,
      reason: "illegal_from_this_status",
    });
  });

  it("refuses to release a file that has no scrub timestamp", async () => {
    // Cannot happen through the application; this simulates a row that got
    // there some other way, to prove the last gate holds.
    const { admin, id } = await reviewAwaitingApproval();
    await db.storedFile.updateMany({
      where: { submissionId: id, kind: "ANNOTATED" },
      data: { scrubbedAt: null },
    });

    expect(await approveReview(admin, id)).toEqual({ ok: false, reason: "not_scrubbed" });
    expect(await statusOf(id)).toBe("UNDER_ADMIN_REVIEW");
  });

  it("cannot approve a review that has not been submitted", async () => {
    const author = await createUser("USER", "Test Author");
    const admin = await createUser("ADMIN", ADMIN_NAME);
    const draft = await createDraft(author, {
      title: "Too early",
      documentTypeId,
      purpose: null,
      description: null,
      instructions: null,
      focusAreas: null,
      deadline: null,
    });
    if (!draft.ok) throw new Error("draft failed");

    expect(await approveReview(admin, draft.id)).toEqual({ ok: false, reason: "no_review" });
  });
});

describe.skipIf(!storageAvailable)("requesting a revision", () => {
  it("sends it back with the note, reopens the review and tells the reviewer", async () => {
    const { admin, reviewer, id } = await reviewAwaitingApproval();

    expect(await requestRevision(admin, id, `  ${REVISION_NOTE}  `)).toEqual({ ok: true });

    expect(await statusOf(id)).toBe("REVISION_REQUESTED");
    const review = await db.review.findFirstOrThrow({ where: { submissionId: id } });
    expect(review).toMatchObject({ status: "DRAFT", revisionRound: 1 });
    const decision = await db.adminDecision.findFirstOrThrow({ where: { reviewId: review.id } });
    expect(decision).toMatchObject({ decision: "REVISION_REQUESTED", note: REVISION_NOTE });

    const notice = await db.notification.findFirstOrThrow({
      where: { submissionId: id, userId: reviewer.id, type: "REVISION_REQUESTED" },
    });
    expect(notice.linkUrl).toBe(`/reviewer/reviews/${id}`);

    // The reviewer's workspace shows the note and is editable again.
    const record = (await findReviewerSubmission(reviewer.id, id))!;
    const workspace = toReviewerSubmissionDTO(record, await findTemplateFor(record), reviewer.id);
    expect(workspace).toMatchObject({
      phase: "working",
      revisionRequested: true,
      revisionNote: REVISION_NOTE,
    });
    // Their earlier answers are still there to edit, not wiped.
    expect(Object.keys(workspace.answers).length).toBeGreaterThanOrEqual(5);
  });

  it("requires a note", async () => {
    const { admin, id } = await reviewAwaitingApproval();

    expect(await requestRevision(admin, id, "   ")).toEqual({ ok: false, reason: "note_required" });
    expect(await statusOf(id)).toBe("UNDER_ADMIN_REVIEW");
  });

  it("can only be done by an administrator", async () => {
    const { reviewer, id } = await reviewAwaitingApproval();

    expect(await requestRevision(reviewer, id, "Let me redo it")).toEqual({
      ok: false,
      reason: "role_not_allowed",
    });
  });
});

describe.skipIf(!storageAvailable)("the full round trip, with a revision bounce", () => {
  it("submit → send back → revise → resubmit → approve → deliver", async () => {
    // The Phase 7 exit criterion.
    const { author, admin, reviewer, id } = await reviewAwaitingApproval();

    // The author sees nothing yet.
    expect(await findOwnReview(author.id, id)).toBeNull();
    expect(await ownReviewedFileUrl(author.id, id)).toBeNull();

    await requestRevision(admin, id, REVISION_NOTE);
    expect(await findOwnReview(author.id, id)).toBeNull();

    // The reviewer revises and resubmits.
    await answerEverything(reviewer, id, "Paragraph two repeats paragraph one; merge them.");
    expect(await submitReview(reviewer, id)).toEqual({ ok: true });
    expect(await statusOf(id)).toBe("UNDER_ADMIN_REVIEW");
    const admins = toAdminReviewDTO((await findReviewForAdmin(id))!)!;
    expect(admins).toMatchObject({ round: 1, awaitingDecision: true });
    expect(admins.criteria.some((c) => c.comment?.includes("merge them"))).toBe(true);

    await approveReview(admin, id);
    expect(await statusOf(id)).toBe("APPROVED");

    // Now the author has it, and reading it is what delivers it.
    const review = toUserReviewDTO((await findOwnReview(author.id, id))!)!;
    expect(review.criteria.some((c) => c.comment?.includes("merge them"))).toBe(true);
    expect(await statusOf(id)).toBe("APPROVED");

    await markDelivered(author.id, id, "view");
    const delivered = await db.submission.findUniqueOrThrow({ where: { id } });
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
    expect(toUserSubmissionDTO((await findOwnSubmission(author.id, id))!).stage).toBe("completed");

    // Both decisions are on record, newest first, and the trail names names.
    const decisions = toAdminReviewDTO((await findReviewForAdmin(id))!)!.decisions;
    expect(decisions.map((d) => d.decision)).toEqual(["APPROVED", "REVISION_REQUESTED"]);
    const trail = (await findSubmissionActivity(id)).map(toActivityDTO);
    expect(trail.map((entry) => entry.label)).toEqual([
      "Delivered to the author",
      "Review approved",
      "Revised review submitted",
      "Revision requested",
      "Review submitted",
      "Review started",
      "Reviewer accepted",
      "Reviewer assigned",
      "Submitted for review",
      "Draft started",
    ]);
    expect(trail[0]!.actor).toBe("System");
    expect(trail.find((e) => e.label === "Review submitted")!.actor).toContain(REVIEWER_NAME);
  });
});

describe.skipIf(!storageAvailable)("delivery", () => {
  it("happens once, on the first view, and not again", async () => {
    const { author, admin, id } = await reviewAwaitingApproval();
    await approveReview(admin, id);

    await markDelivered(author.id, id, "view");
    const first = (await db.submission.findUniqueOrThrow({ where: { id } })).deliveredAt;
    await markDelivered(author.id, id, "view");
    await markDelivered(author.id, id, "download");

    expect((await db.submission.findUniqueOrThrow({ where: { id } })).deliveredAt).toEqual(first);
    expect(
      await db.activityLog.count({ where: { entityId: id, action: "submission.deliver" } }),
    ).toBe(1);
  });

  it("downloading the reviewed file also counts as receiving it", async () => {
    const { author, admin, id } = await reviewAwaitingApproval();
    await approveReview(admin, id);

    expect(await ownReviewedFileUrl(author.id, id)).toBeTruthy();

    expect(await statusOf(id)).toBe("DELIVERED");
    const log = await db.activityLog.findFirstOrThrow({
      where: { entityId: id, action: "submission.deliver" },
    });
    expect(log.metadata).toMatchObject({ trigger: "download" });
    // Still downloadable afterwards.
    expect(await ownReviewedFileUrl(author.id, id)).toBeTruthy();
  });

  it("cannot be triggered by anyone but the author, or before approval", async () => {
    const { author, admin, reviewer, id } = await reviewAwaitingApproval();
    const stranger = await createUser("USER", "Another Author");

    await markDelivered(author.id, id, "view");
    expect(await statusOf(id)).toBe("UNDER_ADMIN_REVIEW");

    await approveReview(admin, id);
    for (const other of [stranger, reviewer, admin]) {
      await markDelivered(other.id, id, "view");
      expect(await ownReviewedFileUrl(other.id, id)).toBeNull();
      expect(await findOwnReview(other.id, id)).toBeNull();
    }
    expect(await statusOf(id)).toBe("APPROVED");
  });
});

describe.skipIf(!storageAvailable)("anonymity: what the author finally receives", () => {
  async function delivered() {
    const cast = await reviewAwaitingApproval();
    await requestRevision(cast.admin, cast.id, `${REVISION_NOTE} — ${ADMIN_NAME}`);
    await answerEverything(cast.reviewer, cast.id);
    await submitReview(cast.reviewer, cast.id);
    await approveReview(cast.admin, cast.id);
    return cast;
  }

  it("names nobody: not the reviewer, not the admin, not the internal note", async () => {
    const { author, reviewer, admin, id } = await delivered();

    const review = toUserReviewDTO((await findOwnReview(author.id, id))!)!;
    const submission = toUserSubmissionDTO((await findOwnSubmission(author.id, id))!);
    const notifications = await db.notification.findMany({
      where: { submissionId: id, userId: author.id },
    });
    const everything = JSON.stringify({ review, submission, notifications });

    expect(review.reviewer).toBe("Anonymous");
    for (const secret of [
      REVIEWER_NAME,
      "Quillfeather",
      reviewer.email,
      reviewer.id,
      ADMIN_NAME,
      admin.id,
      REVISION_NOTE,
    ]) {
      expect(everything).not.toContain(secret);
    }
    // The revision bounce is invisible: the author was never told about it.
    expect(notifications.map((n) => n.type)).not.toContain("REVISION_REQUESTED");
  });

  it("has exactly the fields it is meant to — a new one must be a deliberate decision", async () => {
    const { author, id } = await delivered();

    const review = toUserReviewDTO((await findOwnReview(author.id, id))!)!;

    expect(Object.keys(review).sort()).toEqual(
      ["approvedAt", "criteria", "reviewedFile", "reviewer"].sort(),
    );
    expect(Object.keys(review.criteria[0]!).sort()).toEqual(
      ["comment", "label", "maxRating", "rating"].sort(),
    );
    expect(Object.keys(review.reviewedFile!).sort()).toEqual(["filename", "sizeBytes"]);
  });

  it("the file the author downloads contains the reviewer's name nowhere", async () => {
    // Verification step 6 of the plan, from the author's side.
    const { author, id } = await delivered();

    const response = await fetch((await ownReviewedFileUrl(author.id, id))!);
    const disposition = response.headers.get("content-disposition") ?? "";
    const parts = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const everything = Object.values(parts)
      .map((part) => strFromU8(part))
      .join("\n");

    expect(response.status).toBe(200);
    expect(everything).not.toContain(REVIEWER_NAME);
    expect(everything).not.toContain("Quillfeather");
    expect(everything).toContain('w:author="Reviewer"');
    expect(everything).toContain("Start here.");
    expect(disposition).toMatch(/RF-\d{4}-\d+-reviewed\.docx/);
    expect(disposition).not.toContain("Quillfeather");
  });

  it("never offers the author a file without a scrub timestamp", async () => {
    const { author, id } = await delivered();
    await db.storedFile.updateMany({
      where: { submissionId: id, kind: "ANNOTATED" },
      data: { scrubbedAt: null },
    });

    expect(await ownReviewedFileUrl(author.id, id)).toBeNull();
    expect(toUserReviewDTO((await findOwnReview(author.id, id))!)!.reviewedFile).toBeNull();
  });
});
