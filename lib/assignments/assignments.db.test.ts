// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import {
  assignReviewer,
  findReviewersWithWorkload,
  findSubmissionActivity,
  findSubmissionForAdmin,
  reassignReviewer,
  setAuthorVisibility,
} from "@/lib/assignments";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  toActivityDTO,
  toAdminSubmissionDetailDTO,
  toReviewerOptionDTO,
} from "@/lib/dto/assignment";
import { toAdminSubmissionDTO, toUserSubmissionDTO } from "@/lib/dto/submission";
import type { Role, UserStatus } from "@/lib/generated/prisma/client";
import {
  createDraft,
  findOwnSubmission,
  findSubmissionsForAdmin,
  submitDraft,
} from "@/lib/submissions";
import { dbAvailable, purgeUsers, testEmail } from "@/lib/test/db";
import { transition } from "@/lib/workflow/state-machine";

const FIRST_REVIEWER = "Zebediah Quillfeather";
const SECOND_REVIEWER = "Ottoline Brackenridge";
const DAY = 86_400_000;

const createdUserIds: string[] = [];

async function createUser(
  role: Role,
  name: string,
  status: UserStatus = "ACTIVE",
): Promise<SessionUser> {
  const user = await db.user.create({
    data: { email: testEmail(role.toLowerCase()), name, role, status },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  createdUserIds.push(user.id);
  return user;
}

const documentTypes = dbAvailable
  ? await db.documentType.findMany({ where: { slug: { in: ["personal-statement", "essay"] } } })
  : [];
const typeId = (slug: string) => documentTypes.find((type) => type.slug === slug)!.id;

/** A submission that has been submitted and is waiting for a reviewer. */
async function pendingSubmission(
  author: SessionUser,
  options: { deadline?: Date | null; slug?: string } = {},
): Promise<string> {
  const draft = await createDraft(author, {
    title: "A document awaiting a reviewer",
    documentTypeId: typeId(options.slug ?? "personal-statement"),
    purpose: null,
    description: null,
    instructions: null,
    focusAreas: null,
    deadline: options.deadline === undefined ? new Date(Date.now() + 10 * DAY) : options.deadline,
  });
  if (!draft.ok) throw new Error("draft failed");
  // The file row only; these tests are about assignment, not storage.
  await db.storedFile.create({
    data: {
      submissionId: draft.id,
      kind: "ORIGINAL",
      storageKey: `test/${draft.id}`,
      originalFilename: "statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      checksum: "0".repeat(64),
      uploadedById: author.id,
    },
  });
  const submitted = await submitDraft(author, draft.id);
  if (!submitted.ok) throw new Error("submit failed");
  return draft.id;
}

async function cast() {
  return {
    author: await createUser("USER", "Test Author"),
    admin: await createUser("ADMIN", "Test Admin"),
    first: await createUser("REVIEWER", FIRST_REVIEWER),
    second: await createUser("REVIEWER", SECOND_REVIEWER),
  };
}

afterAll(async () => {
  if (!dbAvailable) return;
  await purgeUsers(createdUserIds);
});

describe.skipIf(!dbAvailable)("assigning a reviewer", () => {
  it("moves to ASSIGNED, creates the assignment, logs it and notifies the reviewer", async () => {
    // The Phase 5 exit criterion.
    const { author, admin, first } = await cast();
    const id = await pendingSubmission(author);

    expect(
      await assignReviewer({ submissionId: id, reviewerId: first.id, admin, ip: "203.0.113.9" }),
    ).toEqual({ ok: true });

    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("ASSIGNED");

    const assignments = await db.assignment.findMany({ where: { submissionId: id } });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      reviewerId: first.id,
      assignedById: admin.id,
      status: "PENDING",
      isActive: true,
    });

    const log = await db.activityLog.findFirstOrThrow({
      where: { entityId: id, action: "submission.assign" },
    });
    expect(log).toMatchObject({ actorId: admin.id, actorRole: "ADMIN", ip: "203.0.113.9" });
    expect(log.metadata).toMatchObject({
      from: "PENDING_ASSIGNMENT",
      to: "ASSIGNED",
      reviewerId: first.id,
    });

    const notice = await db.notification.findFirstOrThrow({
      where: { submissionId: id, userId: first.id },
    });
    expect(notice.type).toBe("ASSIGNMENT_RECEIVED");
  });

  it("defaults the due date to the author's deadline, and accepts an earlier one", async () => {
    const { author, admin, first } = await cast();
    const deadline = new Date(Date.now() + 10 * DAY);
    const defaulted = await pendingSubmission(author, { deadline });
    const explicit = await pendingSubmission(author, { deadline });
    const earlier = new Date(Date.now() + 3 * DAY);

    await assignReviewer({ submissionId: defaulted, reviewerId: first.id, admin });
    await assignReviewer({ submissionId: explicit, reviewerId: first.id, admin, dueAt: earlier });

    const due = async (submissionId: string) =>
      (await db.assignment.findFirstOrThrow({ where: { submissionId } })).dueAt?.getTime();
    expect(await due(defaulted)).toBe(deadline.getTime());
    expect(await due(explicit)).toBe(earlier.getTime());
  });

  it("refuses a due date in the past", async () => {
    const { author, admin, first } = await cast();
    const id = await pendingSubmission(author);

    const result = await assignReviewer({
      submissionId: id,
      reviewerId: first.id,
      admin,
      dueAt: new Date(Date.now() - DAY),
    });

    expect(result).toEqual({ ok: false, reason: "due_in_past" });
    expect(await db.assignment.count({ where: { submissionId: id } })).toBe(0);
  });

  it.each<[string, Role, UserStatus]>([
    ["an author", "USER", "ACTIVE"],
    ["another administrator", "ADMIN", "ACTIVE"],
    ["a suspended reviewer", "REVIEWER", "SUSPENDED"],
    ["a reviewer who has not accepted their invitation", "REVIEWER", "INVITED"],
  ])("will not assign to %s", async (_label, role, status) => {
    const { author, admin } = await cast();
    const id = await pendingSubmission(author);
    const target = await createUser(role, "Not Eligible", status);

    expect(await assignReviewer({ submissionId: id, reviewerId: target.id, admin })).toEqual({
      ok: false,
      reason: "reviewer_unavailable",
    });
    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe(
      "PENDING_ASSIGNMENT",
    );
  });

  it("only lets an administrator assign", async () => {
    const { author, first } = await cast();
    const id = await pendingSubmission(author);

    for (const actor of [author, first]) {
      expect(
        await assignReviewer({ submissionId: id, reviewerId: first.id, admin: actor }),
      ).toEqual({ ok: false, reason: "role_not_allowed" });
    }
    expect(await db.assignment.count({ where: { submissionId: id } })).toBe(0);
  });

  it("cannot assign twice, and a double click leaves exactly one assignment", async () => {
    const { author, admin, first, second } = await cast();
    const id = await pendingSubmission(author);

    const results = await Promise.all([
      assignReviewer({ submissionId: id, reviewerId: first.id, admin }),
      assignReviewer({ submissionId: id, reviewerId: second.id, admin }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.assignment.count({ where: { submissionId: id, isActive: true } })).toBe(1);
    expect(await assignReviewer({ submissionId: id, reviewerId: second.id, admin })).toEqual({
      ok: false,
      reason: "illegal_from_this_status",
    });
  });

  it("cannot assign a draft or a cancelled submission", async () => {
    const { author, admin, first } = await cast();
    const draft = await createDraft(author, {
      title: "Still a draft",
      documentTypeId: typeId("essay"),
      purpose: null,
      description: null,
      instructions: null,
      focusAreas: null,
      deadline: null,
    });
    if (!draft.ok) throw new Error("draft failed");
    const cancelled = await pendingSubmission(author);
    await transition({ submissionId: cancelled, event: "cancel", actor: admin });

    for (const submissionId of [draft.id, cancelled]) {
      expect(await assignReviewer({ submissionId, reviewerId: first.id, admin })).toEqual({
        ok: false,
        reason: "illegal_from_this_status",
      });
    }
  });
});

describe.skipIf(!dbAvailable)("reassigning", () => {
  it("retires the old assignment, creates a new one and tells both reviewers", async () => {
    const { author, admin, first, second } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });

    const result = await reassignReviewer({
      submissionId: id,
      reviewerId: second.id,
      admin,
      reason: "First reviewer is on leave.",
    });

    expect(result).toEqual({ ok: true });
    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("ASSIGNED");

    const assignments = await db.assignment.findMany({
      where: { submissionId: id },
      orderBy: { assignedAt: "asc" },
    });
    // History is kept: two rows, exactly one of them live.
    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toMatchObject({
      reviewerId: first.id,
      status: "CANCELLED",
      isActive: null,
    });
    expect(assignments[0]!.cancelledAt).toBeInstanceOf(Date);
    expect(assignments[1]).toMatchObject({
      reviewerId: second.id,
      status: "PENDING",
      isActive: true,
    });

    const log = await db.activityLog.findFirstOrThrow({
      where: { entityId: id, action: "submission.reassign" },
    });
    expect(log.metadata).toMatchObject({
      reviewerId: second.id,
      previousReviewerId: first.id,
      reason: "First reviewer is on leave.",
    });

    const types = async (userId: string) =>
      (await db.notification.findMany({ where: { submissionId: id, userId } })).map((n) => n.type);
    expect(await types(first.id)).toContain("ASSIGNMENT_CANCELLED");
    expect(await types(second.id)).toContain("ASSIGNMENT_RECEIVED");
  });

  it("keeps the previous due date unless a new one is given", async () => {
    const { author, admin, first, second } = await cast();
    const id = await pendingSubmission(author);
    const due = new Date(Date.now() + 4 * DAY);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin, dueAt: due });

    await reassignReviewer({ submissionId: id, reviewerId: second.id, admin, reason: "Leave." });

    const live = await db.assignment.findFirstOrThrow({
      where: { submissionId: id, isActive: true },
    });
    expect(live.dueAt?.getTime()).toBe(due.getTime());
  });

  it("requires a reason", async () => {
    const { author, admin, first, second } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });

    expect(
      await reassignReviewer({ submissionId: id, reviewerId: second.id, admin, reason: "   " }),
    ).toEqual({ ok: false, reason: "reason_required" });
    expect(await db.assignment.count({ where: { submissionId: id } })).toBe(1);
  });

  it("refuses to reassign to the reviewer who already has it", async () => {
    const { author, admin, first } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });

    expect(
      await reassignReviewer({ submissionId: id, reviewerId: first.id, admin, reason: "Oops." }),
    ).toEqual({ ok: false, reason: "same_reviewer" });
  });

  it("stops the first reviewer acting once it has been taken from them", async () => {
    const { author, admin, first, second } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });
    await reassignReviewer({ submissionId: id, reviewerId: second.id, admin, reason: "Leave." });

    expect(await transition({ submissionId: id, event: "accept", actor: first })).toEqual({
      ok: false,
      reason: "not_yours",
    });
    expect(await transition({ submissionId: id, event: "accept", actor: second })).toMatchObject({
      ok: true,
    });
  });

  it("cannot reassign something that has not been assigned", async () => {
    const { author, admin, first } = await cast();
    const id = await pendingSubmission(author);

    expect(
      await reassignReviewer({ submissionId: id, reviewerId: first.id, admin, reason: "Why." }),
    ).toEqual({ ok: false, reason: "illegal_from_this_status" });
  });
});

describe.skipIf(!dbAvailable)("reviewer workload", () => {
  it("counts what each reviewer currently holds, and how much of it is overdue", async () => {
    const { author, admin, first, second } = await cast();
    const onTime = await pendingSubmission(author);
    const late = await pendingSubmission(author);
    const movedAway = await pendingSubmission(author);
    await assignReviewer({ submissionId: onTime, reviewerId: first.id, admin });
    await assignReviewer({ submissionId: late, reviewerId: first.id, admin });
    await assignReviewer({ submissionId: movedAway, reviewerId: first.id, admin });
    await reassignReviewer({ submissionId: movedAway, reviewerId: second.id, admin, reason: "x" });
    // Make one of the first reviewer's assignments overdue.
    await db.assignment.updateMany({
      where: { submissionId: late },
      data: { dueAt: new Date(Date.now() - DAY) },
    });

    const workload = (await findReviewersWithWorkload()).map(toReviewerOptionDTO);

    expect(workload.find((r) => r.id === first.id)).toMatchObject({
      activeCount: 2,
      overdueCount: 1,
    });
    // The one taken away no longer counts against the first reviewer.
    expect(workload.find((r) => r.id === second.id)).toMatchObject({
      activeCount: 1,
      overdueCount: 0,
    });
  });

  it("lists only active reviewers", async () => {
    const suspended = await createUser("REVIEWER", "Suspended Reviewer", "SUSPENDED");
    const admin = await createUser("ADMIN", "An Admin");
    const active = await createUser("REVIEWER", "Active Reviewer");

    const ids = (await findReviewersWithWorkload()).map((reviewer) => reviewer.id);

    expect(ids).toContain(active.id);
    expect(ids).not.toContain(suspended.id);
    expect(ids).not.toContain(admin.id);
  });
});

describe.skipIf(!dbAvailable)("author visibility", () => {
  it("toggles the flag and records who changed it", async () => {
    const { author, admin } = await cast();
    const id = await pendingSubmission(author);
    const before = (await db.submission.findUniqueOrThrow({ where: { id } }))
      .authorVisibleToReviewer;

    expect(await setAuthorVisibility(id, !before, admin)).toBe(true);

    expect((await db.submission.findUniqueOrThrow({ where: { id } })).authorVisibleToReviewer).toBe(
      !before,
    );
    const log = await db.activityLog.findFirstOrThrow({
      where: { entityId: id, action: "submission.author_visibility" },
    });
    expect(log.actorId).toBe(admin.id);
    expect(log.metadata).toEqual({ authorVisibleToReviewer: !before });
  });

  it("does nothing, and logs nothing, when the value is unchanged", async () => {
    const { author, admin } = await cast();
    const id = await pendingSubmission(author);
    const current = (await db.submission.findUniqueOrThrow({ where: { id } }))
      .authorVisibleToReviewer;

    expect(await setAuthorVisibility(id, current, admin)).toBe(false);
    expect(
      await db.activityLog.count({
        where: { entityId: id, action: "submission.author_visibility" },
      }),
    ).toBe(0);
  });

  it("cannot be changed once the submission is cancelled", async () => {
    const { author, admin } = await cast();
    const id = await pendingSubmission(author);
    const before = (await db.submission.findUniqueOrThrow({ where: { id } }))
      .authorVisibleToReviewer;
    await transition({ submissionId: id, event: "cancel", actor: admin });

    expect(await setAuthorVisibility(id, !before, admin)).toBe(false);
  });
});

describe.skipIf(!dbAvailable)("what the administrator sees", () => {
  it("shows the live assignment, the history, and a named activity trail", async () => {
    const { author, admin, first, second } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });
    await reassignReviewer({
      submissionId: id,
      reviewerId: second.id,
      admin,
      reason: "First reviewer is on leave.",
    });

    const detail = toAdminSubmissionDetailDTO((await findSubmissionForAdmin(id))!);
    const activity = (await findSubmissionActivity(id)).map(toActivityDTO);

    expect(detail.assignment?.reviewer.name).toBe(SECOND_REVIEWER);
    expect(detail.history.map((a) => [a.reviewer.name, a.status, a.isCurrent])).toEqual([
      [SECOND_REVIEWER, "PENDING", true],
      [FIRST_REVIEWER, "CANCELLED", false],
    ]);
    expect(detail).toMatchObject({ canAssign: false, canReassign: true });

    expect(activity.map((entry) => entry.label)).toEqual([
      "Reassigned to another reviewer",
      "Reviewer assigned",
      "Submitted for review",
      "Draft started",
    ]);
    expect(activity[0]).toMatchObject({
      actor: "Test Admin (Administrator)",
      detail: "First reviewer is on leave.",
    });
  });

  it("flags a live assignment that is past its due date", async () => {
    const { author, admin, first } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });
    await db.assignment.updateMany({
      where: { submissionId: id },
      data: { dueAt: new Date(Date.now() - DAY) },
    });

    const detail = toAdminSubmissionDetailDTO((await findSubmissionForAdmin(id))!);

    expect(detail.assignment?.overdue).toBe(true);
  });

  it("never shows an administrator somebody's unsubmitted draft", async () => {
    const author = await createUser("USER", "Private Author");
    const draft = await createDraft(author, {
      title: "Not ready",
      documentTypeId: typeId("essay"),
      purpose: null,
      description: null,
      instructions: null,
      focusAreas: null,
      deadline: null,
    });
    if (!draft.ok) throw new Error("draft failed");

    expect(await findSubmissionForAdmin(draft.id)).toBeNull();
  });

  it("names the current reviewer in the list, and filters by type and deadline", async () => {
    const { author, admin, first } = await cast();
    const soonEssay = await pendingSubmission(author, {
      slug: "essay",
      deadline: new Date(Date.now() + 2 * DAY),
    });
    const laterStatement = await pendingSubmission(author, {
      deadline: new Date(Date.now() + 30 * DAY),
    });
    await assignReviewer({ submissionId: soonEssay, reviewerId: first.id, admin });

    const all = (await findSubmissionsForAdmin()).map(toAdminSubmissionDTO);
    expect(all.find((s) => s.id === soonEssay)?.reviewerName).toBe(FIRST_REVIEWER);
    expect(all.find((s) => s.id === laterStatement)?.reviewerName).toBeNull();

    const ids = async (...args: Parameters<typeof findSubmissionsForAdmin>) =>
      (await findSubmissionsForAdmin(...args)).map((s) => s.id);

    const essays = await ids(undefined, { documentTypeId: typeId("essay") });
    expect(essays).toContain(soonEssay);
    expect(essays).not.toContain(laterStatement);

    const dueThisWeek = await ids(undefined, { due: "week" });
    expect(dueThisWeek).toContain(soonEssay);
    expect(dueThisWeek).not.toContain(laterStatement);

    // Thirty-one days on, the later one is past its deadline too.
    const future = new Date(Date.now() + 31 * DAY);
    expect(await ids(undefined, { due: "overdue" }, future)).toEqual(
      expect.arrayContaining([soonEssay, laterStatement]),
    );
  });
});

describe.skipIf(!dbAvailable)("anonymity after assignment and reassignment", () => {
  it("gives the author no trace of either reviewer", async () => {
    const { author, admin, first, second } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });
    await reassignReviewer({
      submissionId: id,
      reviewerId: second.id,
      admin,
      reason: `${FIRST_REVIEWER} is on leave.`,
    });

    const dto = toUserSubmissionDTO((await findOwnSubmission(author.id, id))!);
    const notifications = await db.notification.findMany({
      where: { submissionId: id, userId: author.id },
    });
    const everythingTheAuthorGets = JSON.stringify({ dto, notifications });

    for (const reviewer of [first, second]) {
      expect(everythingTheAuthorGets).not.toContain(reviewer.name);
      expect(everythingTheAuthorGets).not.toContain(reviewer.email);
      expect(everythingTheAuthorGets).not.toContain(reviewer.id);
    }
    // A reassignment is invisible to the author: still simply "with a reviewer".
    expect(dto.stage).toBe("with_reviewer");
    expect(notifications.filter((n) => n.type === "SUBMISSION_STATUS_CHANGED")).toHaveLength(1);
  });

  it("does not tell the reviewer who the author is in their notification", async () => {
    const { author, admin, first } = await cast();
    const id = await pendingSubmission(author);
    await assignReviewer({ submissionId: id, reviewerId: first.id, admin });

    const notice = await db.notification.findFirstOrThrow({
      where: { submissionId: id, userId: first.id },
    });
    const text = JSON.stringify(notice);

    // Whether a reviewer may know the author is decided per submission, in
    // one place; a notification must not pre-empt it.
    expect(text).not.toContain(author.name);
    expect(text).not.toContain(author.email);
  });
});
