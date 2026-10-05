import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import type { Prisma, SubmissionStatus } from "@/lib/generated/prisma/client";
import { type Notice, queueNotices } from "@/lib/notifications";
import { type SubmissionRef, toReviewer } from "@/lib/notifications/messages";
import { storage } from "@/lib/storage";
import { transition, type TransitionFailure } from "@/lib/workflow/state-machine";

/**
 * Assignment: an administrator giving a submission to a reviewer.
 *
 * Every function here trusts that its caller has already been through
 * `requireRole("ADMIN")`. Status changes go through `transition()`; the
 * Assignment rows are written in the same transaction via its `apply` hook,
 * so a submission can never be ASSIGNED without an assignment, or the
 * reverse.
 */

// ── Reviewers and their workload ───────────────────────────────────────────

/** Assignment states that mean "this reviewer still has this on their plate". */
const OPEN: Prisma.AssignmentWhereInput = {
  isActive: true,
  status: { in: ["PENDING", "ACCEPTED"] },
};

export async function findReviewersWithWorkload(now: Date = new Date()) {
  const reviewers = await db.user.findMany({
    where: { role: "REVIEWER", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      bio: true,
      assignmentsToReview: { where: OPEN, select: { dueAt: true } },
    },
  });

  return reviewers.map(({ assignmentsToReview, ...reviewer }) => ({
    ...reviewer,
    activeCount: assignmentsToReview.length,
    overdueCount: assignmentsToReview.filter(
      (assignment) => assignment.dueAt && assignment.dueAt.getTime() < now.getTime(),
    ).length,
  }));
}

export type ReviewerWorkloadRecord = Awaited<ReturnType<typeof findReviewersWithWorkload>>[number];

// ── Reading a submission as an administrator ───────────────────────────────

const ADMIN_DETAIL_SELECT = {
  id: true,
  reference: true,
  title: true,
  purpose: true,
  description: true,
  instructions: true,
  focusAreas: true,
  deadline: true,
  status: true,
  authorVisibleToReviewer: true,
  createdAt: true,
  submittedAt: true,
  documentType: { select: { id: true, name: true } },
  author: { select: { id: true, name: true, email: true } },
  files: {
    where: { kind: "ORIGINAL" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { originalFilename: true, sizeBytes: true },
  },
  assignments: {
    orderBy: { assignedAt: "desc" },
    select: {
      id: true,
      status: true,
      isActive: true,
      dueAt: true,
      assignedAt: true,
      acceptedAt: true,
      declinedAt: true,
      cancelledAt: true,
      completedAt: true,
      declineReason: true,
      reviewer: { select: { id: true, name: true, email: true } },
      assignedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.SubmissionSelect;

export type AdminSubmissionDetailRecord = Prisma.SubmissionGetPayload<{
  select: typeof ADMIN_DETAIL_SELECT;
}>;

/** A submitted document in full. Drafts are private to their author. */
export function findSubmissionForAdmin(
  submissionId: string,
): Promise<AdminSubmissionDetailRecord | null> {
  return db.submission.findFirst({
    where: { id: submissionId, status: { not: "DRAFT" } },
    select: ADMIN_DETAIL_SELECT,
  });
}

export function findSubmissionActivity(submissionId: string) {
  return db.activityLog.findMany({
    where: { entityType: "Submission", entityId: submissionId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      action: true,
      actorRole: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
}

export type ActivityRecord = Awaited<ReturnType<typeof findSubmissionActivity>>[number];

/** A short-lived link for an administrator to download the author's document. */
export async function adminDocumentDownloadUrl(submissionId: string): Promise<string | null> {
  const file = await db.storedFile.findFirst({
    where: { kind: "ORIGINAL", submission: { id: submissionId, status: { not: "DRAFT" } } },
    orderBy: { createdAt: "desc" },
    select: { storageKey: true, originalFilename: true },
  });
  if (!file) return null;
  return storage().presignDownload({ key: file.storageKey, filename: file.originalFilename });
}

// ── Assigning ──────────────────────────────────────────────────────────────

export type AssignFailure =
  TransitionFailure | "reviewer_unavailable" | "same_reviewer" | "due_in_past" | "reason_required";

export type AssignResult = { ok: true } | { ok: false; reason: AssignFailure };

async function isAvailableReviewer(reviewerId: string): Promise<boolean> {
  return (
    (await db.user.count({ where: { id: reviewerId, role: "REVIEWER", status: "ACTIVE" } })) === 1
  );
}

/**
 * Tells a reviewer about new work, in the bell and by email. The message is
 * built from the reference and title alone: whether they may know who wrote
 * it is decided by `authorVisibleToReviewer`, which is resolved in
 * `toReviewerSubmissionDTO()` and nowhere else.
 */
function assignmentNotice(reviewerId: string, ref: SubmissionRef, dueAt: Date | null): Notice {
  return {
    userId: reviewerId,
    submissionId: ref.id,
    message: toReviewer.assignmentReceived(ref, dueAt ? formatDate(dueAt) : null),
  };
}

type AssignInput = {
  submissionId: string;
  reviewerId: string;
  admin: SessionUser;
  /** When the reviewer should finish. Defaults to the author's deadline. */
  dueAt?: Date | null;
  ip?: string | null;
};

async function resolveDueAt(
  submissionId: string,
  dueAt: Date | null | undefined,
): Promise<{ ok: true; dueAt: Date | null; ref: SubmissionRef } | { ok: false }> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, deadline: true, reference: true, title: true },
  });
  if (!submission) return { ok: false };
  const { deadline, ...ref } = submission;
  return { ok: true, dueAt: dueAt ?? deadline, ref };
}

/** Gives an unassigned submission to a reviewer. */
export async function assignReviewer(input: AssignInput): Promise<AssignResult> {
  const { submissionId, reviewerId, admin } = input;

  if (input.dueAt && input.dueAt.getTime() <= Date.now())
    return { ok: false, reason: "due_in_past" };
  if (!(await isAvailableReviewer(reviewerId)))
    return { ok: false, reason: "reviewer_unavailable" };

  const resolved = await resolveDueAt(submissionId, input.dueAt);
  if (!resolved.ok) return { ok: false, reason: "not_found" };

  const result = await transition({
    submissionId,
    event: "assign",
    actor: admin,
    ip: input.ip,
    metadata: { reviewerId },
    apply: async (tx) => {
      await tx.assignment.create({
        data: {
          submissionId,
          reviewerId,
          assignedById: admin.id,
          isActive: true,
          dueAt: resolved.dueAt,
        },
      });
      await queueNotices(tx, [assignmentNotice(reviewerId, resolved.ref, resolved.dueAt)]);
    },
  });

  return result.ok ? { ok: true } : result;
}

/**
 * Moves a submission from its current reviewer to another, and says why.
 *
 * The old assignment is retired, not overwritten: it stays in the history
 * with its dates, so "who held this document, and when" always has an answer.
 * Any review the first reviewer had started stays attached to their
 * assignment.
 */
export async function reassignReviewer(
  input: AssignInput & { reason: string },
): Promise<AssignResult> {
  const { submissionId, reviewerId, admin } = input;
  const reason = input.reason.trim();

  if (!reason) return { ok: false, reason: "reason_required" };
  if (input.dueAt && input.dueAt.getTime() <= Date.now())
    return { ok: false, reason: "due_in_past" };
  if (!(await isAvailableReviewer(reviewerId)))
    return { ok: false, reason: "reviewer_unavailable" };

  const current = await db.assignment.findFirst({
    where: { submissionId, isActive: true },
    select: { id: true, reviewerId: true, dueAt: true },
  });
  if (current?.reviewerId === reviewerId) return { ok: false, reason: "same_reviewer" };

  const resolved = await resolveDueAt(submissionId, input.dueAt ?? current?.dueAt);
  if (!resolved.ok) return { ok: false, reason: "not_found" };

  const result = await transition({
    submissionId,
    event: "reassign",
    actor: admin,
    ip: input.ip,
    metadata: { reviewerId, previousReviewerId: current?.reviewerId ?? null, reason },
    apply: async (tx) => {
      // Retired with isActive NULL, never false: the unique index on
      // (submissionId, isActive) ignores NULLs, which is what allows many
      // past assignments and exactly one live one.
      const retired = await tx.assignment.findMany({
        where: { submissionId, isActive: true },
        select: { id: true, reviewerId: true },
      });
      await tx.assignment.updateMany({
        where: { id: { in: retired.map((assignment) => assignment.id) } },
        data: { isActive: null, status: "CANCELLED", cancelledAt: new Date() },
      });
      await tx.assignment.create({
        data: {
          submissionId,
          reviewerId,
          assignedById: admin.id,
          isActive: true,
          dueAt: resolved.dueAt,
        },
      });
      await queueNotices(tx, [
        ...retired.map((assignment) => ({
          userId: assignment.reviewerId,
          submissionId,
          message: toReviewer.assignmentCancelled(resolved.ref),
        })),
        assignmentNotice(reviewerId, resolved.ref, resolved.dueAt),
      ]);
    },
  });

  return result.ok ? { ok: true } : result;
}

// ── Author visibility ──────────────────────────────────────────────────────

const VISIBILITY_LOCKED: SubmissionStatus[] = ["DELIVERED", "CANCELLED"];

/**
 * Sets whether the assigned reviewer may see who wrote this submission.
 * (The opposite direction is not configurable: the author never learns who
 * the reviewer is.) Logged, because it changes what a reviewer can see.
 */
export async function setAuthorVisibility(
  submissionId: string,
  visible: boolean,
  admin: SessionUser,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.submission.updateMany({
      where: {
        id: submissionId,
        status: { notIn: ["DRAFT", ...VISIBILITY_LOCKED] },
        authorVisibleToReviewer: !visible,
      },
      data: { authorVisibleToReviewer: visible },
    });
    if (count !== 1) return false;

    await tx.activityLog.create({
      data: {
        action: "submission.author_visibility",
        entityType: "Submission",
        entityId: submissionId,
        actorId: admin.id,
        actorRole: admin.role,
        metadata: { authorVisibleToReviewer: visible },
      },
    });
    return true;
  });
}
