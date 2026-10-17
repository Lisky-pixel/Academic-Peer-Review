// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { decide } from "@/lib/conferences";
import { db } from "@/lib/db";
import { toUserReviewDTOs } from "@/lib/dto/submission";
import type { Role } from "@/lib/generated/prisma/client";
import { runMatching } from "@/lib/matching";
import { declineAssignment, saveReview, submitReview } from "@/lib/reviews";
import { createDraft, findOwnReviews, submitPaper, updatePaper } from "@/lib/submissions";
import { cleanUpTestUsers, dbAvailable, testEmail } from "@/lib/test/db";
import { SYSTEM_ACTOR } from "@/lib/workflow/state-machine";

/**
 * The whole conference flow against the real database: submit, match,
 * decline with a conflict, disagree, tie-break, decide, and read the reviews.
 * Every step goes through the same functions the pages call.
 */

const TAG = randomUUID().slice(0, 8);

async function person(role: Role, institution: string): Promise<SessionUser> {
  const user = await db.user.create({
    data: {
      email: testEmail(role.toLowerCase()),
      name: `${role} ${TAG}`,
      role,
      status: "ACTIVE",
      institution,
    },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  return user;
}

describe.skipIf(!dbAvailable)("a paper's journey through a conference", () => {
  let disciplineId: string;
  let conferenceId: string;
  let author: SessionUser;
  let organiser: SessionUser;
  let sameInstitution: SessionUser;
  const pool: SessionUser[] = [];
  let paperId: string;

  beforeAll(async () => {
    // A discipline of its own, so only this test's reviewers can match.
    disciplineId = (
      await db.discipline.create({ data: { name: `Test discipline ${TAG}` }, select: { id: true } })
    ).id;

    author = await person("USER", "Test University of Lagos");
    organiser = await person("ORGANISER", "Organisers Ltd");
    sameInstitution = await person("REVIEWER", "test university of lagos.");
    for (let i = 0; i < 4; i++) pool.push(await person("REVIEWER", `Elsewhere ${i} ${TAG}`));
    for (const reviewer of [sameInstitution, ...pool]) {
      await db.reviewerProfile.create({
        data: {
          userId: reviewer.id,
          academicRank: "Lecturer",
          yearsExperience: 5,
          expertise: "Testing",
          disciplines: { connect: { id: disciplineId } },
        },
      });
    }

    const day = 86_400_000;
    conferenceId = (
      await db.conference.create({
        data: {
          name: `Test conference ${TAG}`,
          slug: `test-conference-${TAG}`,
          submissionsOpenAt: new Date(Date.now() - day),
          submissionsCloseAt: new Date(Date.now() + 10 * day),
          reviewDeadline: new Date(Date.now() + 30 * day),
          reviewersPerPaper: 2,
          maxPapersPerReviewer: 3,
          doubleBlind: true,
          submissionFormat: "ABSTRACT_ONLY",
          topics: ["Testing"],
          organisers: { create: { userId: organiser.id } },
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanUpTestUsers();
    await db.conference.deleteMany({ where: { id: conferenceId } });
    await db.discipline.deleteMany({ where: { id: disciplineId } });
  });

  const details = () => ({
    title: "A study of testing",
    authorNames: "A. Author, B. Author",
    contactEmail: author.email,
    institution: "Test University of Lagos",
    topic: "Testing",
    disciplineId,
    disciplineOther: null,
    paperType: "QUANTITATIVE" as const,
    abstract: "An abstract long enough to count as one, describing a study of testing.",
  });

  it("is drafted and submitted, and the submitter is told", async () => {
    const draft = await createDraft(author, conferenceId, details(), false);
    expect(draft.ok).toBe(true);
    paperId = (draft as { id: string }).id;

    expect(await submitPaper(author, paperId, false)).toEqual({
      ok: false,
      reason: "no_declaration",
    });
    expect(await submitPaper(author, paperId, true)).toEqual({ ok: true });

    const paper = await db.submission.findUniqueOrThrow({ where: { id: paperId } });
    expect(paper.status).toBe("SUBMITTED");
    expect(paper.reference).toMatch(/^APR-\d{4}-\d{4}$/);
    expect(
      await db.notification.count({ where: { userId: author.id, type: "SUBMISSION_RECEIVED" } }),
    ).toBe(1);

    // Still editable until reviewers have it.
    expect(await updatePaper(author, paperId, { ...details(), title: "Retitled" }, false)).toEqual({
      ok: true,
    });
  });

  it("is matched to two reviewers, never from the author's institution", async () => {
    const summary = await runMatching(conferenceId, SYSTEM_ACTOR);
    expect(summary).toMatchObject({ papers: 1, assigned: 2, stillShort: 0 });

    const assignments = await db.assignment.findMany({ where: { submissionId: paperId } });
    expect(assignments).toHaveLength(2);
    expect(assignments.map((a) => a.reviewerId)).not.toContain(sameInstitution.id);
    expect(assignments.map((a) => a.reviewerId)).not.toContain(author.id);

    const paper = await db.submission.findUniqueOrThrow({ where: { id: paperId } });
    expect(paper.status).toBe("UNDER_REVIEW");
    // Locked now.
    expect(await updatePaper(author, paperId, details(), false)).toEqual({
      ok: false,
      reason: "not_editable",
    });
  });

  it("goes to someone else when a reviewer declares a conflict", async () => {
    const first = await db.assignment.findFirstOrThrow({ where: { submissionId: paperId } });
    const reviewer = pool.find((r) => r.id === first.reviewerId)!;

    expect(await declineAssignment(reviewer, paperId, { reason: "", conflict: true })).toEqual({
      ok: true,
    });

    const live = await db.assignment.findMany({
      where: { submissionId: paperId, status: { in: ["PENDING", "ACCEPTED"] } },
    });
    expect(live).toHaveLength(2);
    expect(live.map((a) => a.reviewerId)).not.toContain(reviewer.id);
    expect(await db.assignment.findFirstOrThrow({ where: { id: first.id } })).toMatchObject({
      status: "DECLINED",
      conflictDeclared: true,
    });
  });

  it("adds a tie-breaker when the two reviews disagree", async () => {
    const live = await db.assignment.findMany({
      where: { submissionId: paperId, status: { in: ["PENDING", "ACCEPTED"] } },
      orderBy: { assignedAt: "asc" },
    });
    const [one, two] = live.map((a) => pool.find((r) => r.id === a.reviewerId)!);

    await saveReview(one!, paperId, {
      score: 5,
      recommend: true,
      comments: "Excellent work, accept it.",
    });
    expect(await submitReview(one!, paperId)).toEqual({ ok: true });
    // Sent reviews cannot be changed.
    expect(await saveReview(one!, paperId, { score: 1, recommend: false, comments: "x" })).toEqual({
      ok: false,
      reason: "not_editable",
    });

    await saveReview(two!, paperId, {
      score: 2,
      recommend: false,
      comments: "Weak methods, reject it.",
    });
    expect(await submitReview(two!, paperId)).toEqual({ ok: true });

    const tiebreaker = await db.assignment.findFirstOrThrow({
      where: { submissionId: paperId, isTiebreaker: true },
    });
    expect(tiebreaker.status).toBe("PENDING");
    expect(tiebreaker.assignedById).toBeNull();
    expect((await db.submission.findUniqueOrThrow({ where: { id: paperId } })).status).toBe(
      "UNDER_REVIEW",
    );

    const third = pool.find((r) => r.id === tiebreaker.reviewerId)!;
    await saveReview(third, paperId, {
      score: 4,
      recommend: true,
      comments: "On balance, I would accept it.",
    });
    expect(await submitReview(third, paperId)).toEqual({ ok: true });

    expect((await db.submission.findUniqueOrThrow({ where: { id: paperId } })).status).toBe(
      "REVIEWS_COMPLETE",
    );
    expect(
      await db.notification.count({ where: { userId: organiser.id, type: "REVIEWS_COMPLETE" } }),
    ).toBe(1);
  });

  it("is decided by the organiser, and the submitter reads anonymous reviews", async () => {
    expect(await findOwnReviews(author.id, paperId)).toHaveLength(0);

    expect(await decide(organiser, conferenceId, paperId, true, "Well done.")).toEqual({
      ok: true,
    });
    const paper = await db.submission.findUniqueOrThrow({ where: { id: paperId } });
    expect(paper).toMatchObject({ status: "ACCEPTED", decisionNote: "Well done." });

    const reviews = toUserReviewDTOs(await findOwnReviews(author.id, paperId));
    expect(reviews.map((r) => r.reviewer)).toEqual(["Reviewer 1", "Reviewer 2", "Reviewer 3"]);
    const text = JSON.stringify(reviews);
    for (const reviewer of pool) {
      expect(text).not.toContain(reviewer.name);
      expect(text).not.toContain(reviewer.email);
    }
    expect(
      await db.notification.count({ where: { userId: author.id, type: "DECISION_MADE" } }),
    ).toBe(1);
  });

  it("refuses a decision from an organiser of another conference", async () => {
    const outsider = await person("ORGANISER", "Elsewhere");
    expect(await decide(outsider, conferenceId, paperId, false, "")).toMatchObject({ ok: false });
  });
});
