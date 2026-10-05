// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { findActivity } from "@/lib/admin/activity";
import {
  createDocumentType,
  findDocumentTypeDetail,
  findDocumentTypesForAdmin,
  publishTemplate,
  setDocumentTypeActive,
  updateDocumentType,
} from "@/lib/admin/document-types";
import { findAdminCounts, findReports } from "@/lib/admin/reports";
import { type CriterionInput, STARTER_CRITERIA } from "@/lib/admin/template-schema";
import { findUsers, reactivateUser, suspendUser } from "@/lib/admin/users";
import { assignReviewer } from "@/lib/assignments";
import { authenticate } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { createSession, type SessionUser, validateSessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  toActivityEntryDTO,
  toAdminUserDTO,
  toDocumentTypeDetailDTO,
  toDocumentTypeListDTO,
} from "@/lib/dto/admin";
import type { Role, UserStatus } from "@/lib/generated/prisma/client";
import {
  acceptAssignment,
  findReviewerSubmission,
  findTemplateFor,
  saveReviewDraft,
} from "@/lib/reviews";
import { createDraft, findDocumentTypes, submitDraft } from "@/lib/submissions";
import {
  cleanUpTestDocumentTypes,
  dbAvailable,
  purgeUsers,
  testEmail,
  testIp,
} from "@/lib/test/db";

const PASSWORD = "correct horse battery";
const DAY = 86_400_000;
const passwordHash = dbAvailable ? await hashPassword(PASSWORD) : "";

const createdUserIds: string[] = [];
const createdTypeIds: string[] = [];

async function createUser(
  role: Role,
  name: string,
  status: UserStatus = "ACTIVE",
): Promise<SessionUser> {
  const user = await db.user.create({
    data: { email: testEmail(role.toLowerCase()), name, role, status, passwordHash },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  createdUserIds.push(user.id);
  return user;
}

/** A document type nothing else uses, so its template can be changed freely. */
async function createType(admin: SessionUser) {
  const result = await createDocumentType(admin, {
    name: `Test type ${randomUUID().slice(0, 8)}`,
    description: "Made by a test",
  });
  if (!result.ok) throw new Error("type failed");
  createdTypeIds.push(result.id);
  return result.id;
}

async function submissionOf(author: SessionUser, documentTypeId: string) {
  const draft = await createDraft(author, {
    title: "A document",
    documentTypeId,
    purpose: null,
    description: null,
    instructions: null,
    focusAreas: null,
    deadline: null,
  });
  if (!draft.ok) throw new Error("draft failed");
  await db.storedFile.create({
    data: {
      submissionId: draft.id,
      kind: "ORIGINAL",
      storageKey: `test/${draft.id}`,
      originalFilename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      checksum: "0".repeat(64),
      uploadedById: author.id,
    },
  });
  await submitDraft(author, draft.id);
  return draft.id;
}

afterAll(async () => {
  if (!dbAvailable) return;
  await db.review.deleteMany({ where: { submission: { authorId: { in: createdUserIds } } } });
  await purgeUsers(createdUserIds);
  await db.activityLog.deleteMany({ where: { entityId: { in: createdTypeIds } } });
  // Criteria cascade with their template.
  await db.reviewTemplate.deleteMany({ where: { documentTypeId: { in: createdTypeIds } } });
  await db.documentType.deleteMany({ where: { id: { in: createdTypeIds } } });
  await cleanUpTestDocumentTypes();
});

describe.skipIf(!dbAvailable)("suspending an account", () => {
  it("stops them signing in and ends every session they have, at once", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const user = await createUser("USER", "To Suspend");
    const session = await createSession(user.id);

    expect(await suspendUser(admin, user.id)).toEqual({ ok: true });

    expect(await validateSessionToken(session.token)).toBeNull();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    // The same answer as a wrong password: it does not announce the suspension.
    expect(await authenticate(user.email, PASSWORD, testIp())).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    const log = await db.activityLog.findFirstOrThrow({
      where: { action: "user.suspended", entityId: user.id },
    });
    expect(log.actorId).toBe(admin.id);
  });

  it("keeps everything they did", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const author = await createUser("USER", "Prolific Author");
    const typeId = (await findDocumentTypes())[0]!.id;
    const submissionId = await submissionOf(author, typeId);

    await suspendUser(admin, author.id);

    expect(await db.submission.count({ where: { id: submissionId } })).toBe(1);
    expect(await db.user.count({ where: { id: author.id } })).toBe(1);
  });

  it("refuses to let an administrator suspend themselves", async () => {
    const admin = await createUser("ADMIN", "Test Admin");

    expect(await suspendUser(admin, admin.id)).toEqual({ ok: false, reason: "is_you" });
  });

  it("refuses to suspend the only administrator who can still sign in", async () => {
    const acting = await createUser("ADMIN", "Acting Admin");
    const target = await createUser("ADMIN", "Target Admin");
    // Simulate these two being the only administrators there are.
    const others = await db.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE", id: { notIn: [acting.id, target.id] } },
      select: { id: true },
    });
    const otherIds = others.map((other) => other.id);
    await db.user.updateMany({ where: { id: { in: otherIds } }, data: { status: "SUSPENDED" } });
    try {
      // Two left: one may go.
      expect(await suspendUser(acting, target.id)).toEqual({ ok: true });
      await reactivateUser(acting, target.id);
      // But not the last one — tried here by an admin who is themselves no
      // longer active, which is the only way the question can arise.
      await db.user.update({ where: { id: acting.id }, data: { status: "SUSPENDED" } });
      expect(await suspendUser(acting, target.id)).toEqual({ ok: false, reason: "last_admin" });
    } finally {
      await db.user.updateMany({ where: { id: { in: otherIds } }, data: { status: "ACTIVE" } });
    }
  });

  it.each<UserStatus>(["INVITED", "UNVERIFIED", "SUSPENDED"])(
    "only suspends active accounts, not %s ones",
    async (status) => {
      const admin = await createUser("ADMIN", "Test Admin");
      const user = await createUser("USER", "Not Active", status);

      expect(await suspendUser(admin, user.id)).toEqual({ ok: false, reason: "not_active" });
    },
  );

  it("reactivating lets them sign in again, and is logged", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const user = await createUser("USER", "Comes Back");
    await suspendUser(admin, user.id);

    expect(await reactivateUser(admin, user.id)).toBe(true);

    expect(await authenticate(user.email, PASSWORD, testIp())).toMatchObject({ ok: true });
    expect(await reactivateUser(admin, user.id)).toBe(false);
    expect(
      await db.activityLog.count({ where: { action: "user.reactivated", entityId: user.id } }),
    ).toBe(1);
  });

  it("cannot reactivate an invitation or an unconfirmed registration into an account", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const invited = await createUser("REVIEWER", "Invited", "INVITED");

    expect(await reactivateUser(admin, invited.id)).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: invited.id } })).status).toBe("INVITED");
  });
});

describe.skipIf(!dbAvailable)("listing people", () => {
  it("filters by role and status and searches name and email, case-insensitively", async () => {
    const tag = randomUUID().slice(0, 8);
    const reviewer = await createUser("REVIEWER", `Findable ${tag}`);
    const suspended = await createUser("USER", `Findable ${tag} Two`, "SUSPENDED");

    const byName = await findUsers({ query: `findable ${tag}` });
    expect(byName.map((user) => user.id).sort()).toEqual([reviewer.id, suspended.id].sort());

    expect((await findUsers({ query: tag, role: "REVIEWER" })).map((u) => u.id)).toEqual([
      reviewer.id,
    ]);
    expect((await findUsers({ query: tag, status: "SUSPENDED" })).map((u) => u.id)).toEqual([
      suspended.id,
    ]);
    expect((await findUsers({ query: reviewer.email.toUpperCase() })).map((u) => u.id)).toEqual([
      reviewer.id,
    ]);
  });

  it("never includes a password hash or a picture in what the page receives", async () => {
    const user = await createUser("USER", "Private Fields");

    const dto = toAdminUserDTO((await findUsers({ query: user.email }))[0]!);

    expect(Object.keys(dto).sort()).toEqual(
      [
        "email",
        "id",
        "joinedAt",
        "lastSeenAt",
        "name",
        "openReviews",
        "role",
        "status",
        "submissions",
      ].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain("argon2");
  });
});

describe.skipIf(!dbAvailable)("document types", () => {
  it("a new type is usable at once: on offer, with a version 1 template", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);

    const detail = toDocumentTypeDetailDTO((await findDocumentTypeDetail(id))!);

    expect(detail).toMatchObject({ isActive: true, current: { version: 1, isCurrent: true } });
    expect(detail.current!.criteria.map((c) => c.label)).toEqual(
      STARTER_CRITERIA.map((c) => c.label),
    );
    expect((await findDocumentTypes()).map((type) => type.id)).toContain(id);
    const listed = (await findDocumentTypesForAdmin()).map(toDocumentTypeListDTO);
    expect(listed.find((type) => type.id === id)).toMatchObject({
      templateVersion: 1,
      criteriaCount: STARTER_CRITERIA.length,
    });
  });

  it("refuses a name that is already taken, in any case", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);
    const { name } = (await findDocumentTypeDetail(id))!;

    expect(await createDocumentType(admin, { name, description: null })).toEqual({
      ok: false,
      reason: "name_taken",
    });
    expect(
      await createDocumentType(admin, { name: name.toUpperCase(), description: null }),
    ).toEqual({ ok: false, reason: "name_taken" });
  });

  it("can be renamed", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);
    const name = `Renamed ${randomUUID().slice(0, 8)}`;

    expect(await updateDocumentType(admin, id, { name, description: "New words" })).toEqual({
      ok: true,
      id,
    });

    expect(await findDocumentTypeDetail(id)).toMatchObject({ name, description: "New words" });
  });

  it("withdrawing hides it from authors but keeps existing submissions", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const author = await createUser("USER", "Test Author");
    const id = await createType(admin);
    const submissionId = await submissionOf(author, id);

    expect(await setDocumentTypeActive(admin, id, false)).toEqual({ ok: true });

    expect((await findDocumentTypes()).map((type) => type.id)).not.toContain(id);
    expect(await db.submission.count({ where: { id: submissionId } })).toBe(1);
    // And a new draft of that type is refused.
    expect(
      await createDraft(author, {
        title: "Too late",
        documentTypeId: id,
        purpose: null,
        description: null,
        instructions: null,
        focusAreas: null,
        deadline: null,
      }),
    ).toEqual({ ok: false, reason: "unknown_document_type" });

    expect(await setDocumentTypeActive(admin, id, true)).toEqual({ ok: true });
    expect((await findDocumentTypes()).map((type) => type.id)).toContain(id);
  });
});

describe.skipIf(!dbAvailable)("template versioning", () => {
  const edited = (): CriterionInput[] => [
    { label: "Tone", helpText: "Is the voice right?", inputType: "BOTH", required: true },
    { label: "Overall feedback", helpText: null, inputType: "TEXT", required: true },
  ];

  it("editing publishes a new version and leaves the old one exactly as it was", async () => {
    // The Phase 9 exit criterion: template edits version rather than mutate.
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);
    const before = (await findDocumentTypeDetail(id))!.templates[0]!;

    expect(await publishTemplate(admin, id, edited())).toEqual({
      ok: true,
      version: 2,
      changed: true,
    });

    const detail = toDocumentTypeDetailDTO((await findDocumentTypeDetail(id))!);
    expect(detail.versions.map((v) => [v.version, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(detail.current!.criteria.map((c) => c.label)).toEqual(["Tone", "Overall feedback"]);

    // Version 1: same row, same criteria rows, untouched.
    const v1 = await db.reviewTemplate.findUniqueOrThrow({
      where: { id: before.id },
      include: { criteria: { orderBy: { sortOrder: "asc" } } },
    });
    expect(v1.isActive).toBeNull();
    expect(v1.criteria.map((c) => c.label)).toEqual(STARTER_CRITERIA.map((c) => c.label));
    expect(await db.reviewTemplate.count({ where: { documentTypeId: id, isActive: true } })).toBe(
      1,
    );
  });

  it("a review already in progress keeps the questions it started with", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const author = await createUser("USER", "Test Author");
    const reviewer = await createUser("REVIEWER", "Test Reviewer");
    const typeId = await createType(admin);
    const submissionId = await submissionOf(author, typeId);
    await assignReviewer({ submissionId, reviewerId: reviewer.id, admin });
    await acceptAssignment(reviewer, submissionId);
    const original = (await findTemplateFor(
      (await findReviewerSubmission(reviewer.id, submissionId))!,
    ))!;
    await saveReviewDraft(reviewer, submissionId, [
      { criterionId: original.criteria[0]!.id, rating: 4, comment: "Fine." },
    ]);

    await publishTemplate(admin, typeId, edited());

    const stillUsing = (await findTemplateFor(
      (await findReviewerSubmission(reviewer.id, submissionId))!,
    ))!;
    expect(stillUsing.id).toBe(original.id);
    expect(stillUsing.criteria.map((c) => c.label)).toEqual(STARTER_CRITERIA.map((c) => c.label));
    const answer = await db.reviewResponse.findFirstOrThrow({
      where: { review: { submissionId } },
      include: { criterion: true },
    });
    expect(answer).toMatchObject({ rating: 4, criterion: { label: "Grammar and mechanics" } });

    // A review started after the change gets the new questions.
    const laterSubmission = await submissionOf(author, typeId);
    await assignReviewer({ submissionId: laterSubmission, reviewerId: reviewer.id, admin });
    await acceptAssignment(reviewer, laterSubmission);
    const fresh = (await findTemplateFor(
      (await findReviewerSubmission(reviewer.id, laterSubmission))!,
    ))!;
    expect(fresh.criteria.map((c) => c.label)).toEqual(["Tone", "Overall feedback"]);

    // And the history shows which version each review belongs to.
    const detail = toDocumentTypeDetailDTO((await findDocumentTypeDetail(typeId))!);
    expect(detail.versions.find((v) => v.version === 1)!.reviews).toBe(1);
  });

  it("makes no new version when nothing has changed", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);

    expect(
      await publishTemplate(
        admin,
        id,
        STARTER_CRITERIA.map((c) => ({ ...c })),
      ),
    ).toEqual({ ok: true, version: 1, changed: false });
    expect(await db.reviewTemplate.count({ where: { documentTypeId: id } })).toBe(1);
  });

  it("counts a reordering as a change", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);
    const reordered = [STARTER_CRITERIA[1]!, STARTER_CRITERIA[0]!, ...STARTER_CRITERIA.slice(2)];

    expect(await publishTemplate(admin, id, reordered)).toMatchObject({
      version: 2,
      changed: true,
    });
  });

  it("leaves exactly one current version when two administrators save at once", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);

    const results = await Promise.all([
      publishTemplate(admin, id, edited()),
      publishTemplate(admin, id, [
        { label: "Evidence", helpText: null, inputType: "RATING", required: true },
      ]),
    ]);

    expect(results.some((result) => result.ok)).toBe(true);
    expect(await db.reviewTemplate.count({ where: { documentTypeId: id, isActive: true } })).toBe(
      1,
    );
    const versions = await db.reviewTemplate.findMany({ where: { documentTypeId: id } });
    expect(new Set(versions.map((v) => v.version)).size).toBe(versions.length);
  });

  it("records each publication in the activity log", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await createType(admin);
    await publishTemplate(admin, id, edited());

    const { items } = await findActivity({ category: "setup" });
    const mine = items.filter((item) => item.entityId === id).map(toActivityEntryDTO);

    expect(mine.map((entry) => entry.label)).toEqual([
      "Review template updated",
      "Document type added",
    ]);
    expect(mine[0]).toMatchObject({
      detail: "Version 2",
      actor: "Test Admin (Administrator)",
      href: `/admin/document-types/${id}`,
    });
  });
});

describe.skipIf(!dbAvailable)("the activity log", () => {
  it("filters by kind and by date, newest first, and names the subject", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const author = await createUser("USER", "Test Author");
    const typeId = (await findDocumentTypes())[0]!.id;
    const submissionId = await submissionOf(author, typeId);
    await suspendUser(admin, author.id);

    const submissions = await findActivity({ category: "submission" });
    const mine = submissions.items.filter((item) => item.entityId === submissionId);
    expect(mine.map((item) => item.action)).toEqual([
      "submission.submit",
      "submission.create_draft",
    ]);
    expect(mine[0]!.subject).toMatch(/^RF-\d{4}-\d+$/);
    expect(toActivityEntryDTO(mine[0]!).href).toBe(`/admin/submissions/${submissionId}`);
    expect(submissions.items.every((item) => item.action.startsWith("submission."))).toBe(true);

    const people = await findActivity({ category: "user" });
    const suspension = people.items.find((item) => item.entityId === author.id)!;
    expect(toActivityEntryDTO(suspension)).toMatchObject({
      label: "Account suspended",
      subject: "Test Author",
      href: null,
    });

    // A window that ended yesterday contains none of it.
    const yesterday = new Date(Date.now() - DAY);
    const old = await findActivity({ category: "submission", to: yesterday });
    expect(old.items.some((item) => item.entityId === submissionId)).toBe(false);
    // Today, as a single-day window, contains all of it.
    const today = new Date(new Date().toISOString().slice(0, 10));
    const current = await findActivity({ category: "submission", from: today, to: today });
    expect(current.items.some((item) => item.entityId === submissionId)).toBe(true);
  });

  it("pages through results without overlap", async () => {
    const first = await findActivity({ page: 1 });
    const second = await findActivity({ page: 2 });

    expect(first.page).toBe(1);
    expect(first.pages).toBe(Math.max(1, Math.ceil(first.total / 50)));
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.some((item) => firstIds.has(item.id))).toBe(false);
    // A nonsense page number is treated as the first page.
    expect((await findActivity({ page: -3 })).page).toBe(1);
  });
});

describe.skipIf(!dbAvailable)("dashboard counts and reports", () => {
  it("counts move as a submission moves through the workflow", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const author = await createUser("USER", "Test Author");
    const reviewer = await createUser("REVIEWER", "Test Reviewer");
    const typeId = (await findDocumentTypes())[0]!.id;
    const before = await findAdminCounts();

    const submissionId = await submissionOf(author, typeId);
    const submitted = await findAdminCounts();
    expect(submitted.needsReviewer).toBe(before.needsReviewer + 1);

    await assignReviewer({ submissionId, reviewerId: reviewer.id, admin });
    const assigned = await findAdminCounts();
    expect(assigned.needsReviewer).toBe(before.needsReviewer);
    expect(assigned.withReviewers).toBe(before.withReviewers + 1);

    await db.assignment.updateMany({
      where: { submissionId },
      data: { dueAt: new Date(Date.now() - DAY) },
    });
    expect((await findAdminCounts()).overdueReviews).toBe(before.overdueReviews + 1);
  });

  it("reports this week's submissions, and each reviewer's load", async () => {
    const admin = await createUser("ADMIN", "Test Admin");
    const author = await createUser("USER", "Test Author");
    const reviewer = await createUser("REVIEWER", `Reported ${randomUUID().slice(0, 8)}`);
    const typeId = (await findDocumentTypes())[0]!.id;
    const before = await findReports();

    const submissionId = await submissionOf(author, typeId);
    await assignReviewer({ submissionId, reviewerId: reviewer.id, admin });
    await db.assignment.updateMany({
      where: { submissionId },
      data: { dueAt: new Date(Date.now() - DAY) },
    });

    const after = await findReports();
    expect(after.perWeek).toHaveLength(12);
    expect(after.perWeek.at(-1)!.count).toBe(before.perWeek.at(-1)!.count + 1);
    expect(after.reviewers.find((row) => row.id === reviewer.id)).toMatchObject({
      name: reviewer.name,
      completed: 0,
      averageDays: null,
      open: 1,
      overdue: 1,
    });
  });

  it("measures turnaround from submission to approval", async () => {
    const author = await createUser("USER", "Test Author");
    const admin = await createUser("ADMIN", "Test Admin");
    const typeId = await createType(admin);
    const typeName = (await findDocumentTypeDetail(typeId))!.name;
    const submissionId = await submissionOf(author, typeId);
    const approvedAt = new Date();
    // Not through the workflow: this test is about the arithmetic.
    await db.submission.update({
      where: { id: submissionId },
      data: { submittedAt: new Date(approvedAt.getTime() - 3 * DAY), approvedAt },
    });

    const row = (await findReports()).turnaroundByType.find((r) => r.documentType === typeName);

    expect(row).toEqual({ documentType: typeName, count: 1, averageDays: 3, medianDays: 3 });
  });
});
