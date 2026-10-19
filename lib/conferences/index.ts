import type { SessionUser } from "@/lib/auth/session";
import {
  type ConferenceInput,
  formatMoney,
  type PaymentInput,
  slugify,
} from "@/lib/conferences/schema";
import { db } from "@/lib/db";
import { kickEmailDispatch } from "@/lib/email/outbox";
import { formatDate } from "@/lib/format";
import type { Prisma, SubmissionStatus } from "@/lib/generated/prisma/client";
import { LIVE_ASSIGNMENT, settleReviews } from "@/lib/matching";
import { dueDateFor, sharesInstitution } from "@/lib/matching/select";
import { type Notice, queueNotices } from "@/lib/notifications";
import { toOrganiser, toReviewer } from "@/lib/notifications/messages";
import { previewOf } from "@/lib/reviews/preview";
import { storage } from "@/lib/storage";
import { transition, type TransitionFailure } from "@/lib/workflow/state-machine";

/**
 * Conferences, from the organiser's and the administrator's side.
 *
 * Administrators create conferences and attach organisers to them; an
 * organiser sees and acts on only the conferences they are attached to. An
 * administrator can act as the organiser of any conference.
 *
 * Every organiser function takes the conference id and checks the paper
 * belongs to it, so a paper id from another conference is "not found".
 */

// ── Access ─────────────────────────────────────────────────────────────────

/** Whether `user` may run this conference. */
export async function canOrganise(user: SessionUser, conferenceId: string): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role !== "ORGANISER") return false;
  const row = await db.conferenceOrganiser.count({ where: { conferenceId, userId: user.id } });
  return row > 0;
}

// ── Listing ────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true,
  name: true,
  venue: true,
  startsOn: true,
  endsOn: true,
  submissionsOpenAt: true,
  submissionsCloseAt: true,
  reviewDeadline: true,
  packageName: true,
  submissionLimit: true,
  matchedAt: true,
  status: true,
  declineReason: true,
  organisers: { select: { user: { select: { id: true, name: true, email: true } } } },
  _count: { select: { submissions: { where: { status: { notIn: ["DRAFT", "WITHDRAWN"] } } } } },
} satisfies Prisma.ConferenceSelect;

export type ConferenceListRecord = Prisma.ConferenceGetPayload<{ select: typeof LIST_SELECT }>;

/** The conferences this person runs: all of them for an administrator. */
export function findConferencesFor(user: SessionUser): Promise<ConferenceListRecord[]> {
  return db.conference.findMany({
    where: user.role === "ADMIN" ? {} : { organisers: { some: { userId: user.id } } },
    orderBy: [{ submissionsCloseAt: "desc" }],
    select: LIST_SELECT,
  });
}

const DETAIL_SELECT = {
  ...LIST_SELECT,
  slug: true,
  description: true,
  reviewersPerPaper: true,
  maxPapersPerReviewer: true,
  doubleBlind: true,
  submissionFormat: true,
  topics: true,
  createdAt: true,
  payments: {
    orderBy: { paidAt: "desc" },
    select: {
      id: true,
      amountMinor: true,
      currency: true,
      description: true,
      reference: true,
      paidAt: true,
      receiptNumber: true,
      receiptSentAt: true,
      recordedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.ConferenceSelect;

export type ConferenceDetailRecord = Prisma.ConferenceGetPayload<{ select: typeof DETAIL_SELECT }>;

export function findConference(conferenceId: string): Promise<ConferenceDetailRecord | null> {
  return db.conference.findUnique({ where: { id: conferenceId }, select: DETAIL_SELECT });
}

// ── Creating and editing (administrators) ──────────────────────────────────

export async function uniqueSlug(tx: Prisma.TransactionClient, name: string, ignoreId?: string) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 50; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await tx.conference.findUnique({ where: { slug }, select: { id: true } });
    if (!taken || taken.id === ignoreId) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function createConference(
  admin: SessionUser,
  input: ConferenceInput,
): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const conference = await tx.conference.create({
      data: { ...input, slug: await uniqueSlug(tx, input.name) },
      select: { id: true },
    });
    await tx.activityLog.create({
      data: {
        action: "conference.created",
        entityType: "Conference",
        entityId: conference.id,
        actorId: admin.id,
        actorRole: admin.role,
        metadata: { name: input.name },
      },
    });
    return conference;
  });
}

export async function updateConference(
  admin: SessionUser,
  conferenceId: string,
  input: ConferenceInput,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const existing = await tx.conference.findUnique({
      where: { id: conferenceId },
      select: { id: true },
    });
    if (!existing) return false;
    await tx.conference.update({ where: { id: conferenceId }, data: input });
    await tx.activityLog.create({
      data: {
        action: "conference.updated",
        entityType: "Conference",
        entityId: conferenceId,
        actorId: admin.id,
        actorRole: admin.role,
      },
    });
    return true;
  });
}

// ── Organisers (administrators) ────────────────────────────────────────────

export type AddOrganiserResult =
  { ok: true } | { ok: false; reason: "no_such_organiser" | "already_added" };

/** Attaches an existing organiser account to a conference. */
export async function addOrganiser(
  admin: SessionUser,
  conferenceId: string,
  userId: string,
): Promise<AddOrganiserResult> {
  const user = await db.user.findFirst({
    where: { id: userId, role: "ORGANISER", status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true },
  });
  if (!user) return { ok: false, reason: "no_such_organiser" };

  try {
    await db.conferenceOrganiser.create({ data: { conferenceId, userId } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      return { ok: false, reason: "already_added" };
    throw error;
  }
  await db.activityLog.create({
    data: {
      action: "conference.organiser_added",
      entityType: "Conference",
      entityId: conferenceId,
      actorId: admin.id,
      actorRole: admin.role,
      metadata: { userId },
    },
  });
  return { ok: true };
}

export async function removeOrganiser(
  admin: SessionUser,
  conferenceId: string,
  userId: string,
): Promise<boolean> {
  const { count } = await db.conferenceOrganiser.deleteMany({ where: { conferenceId, userId } });
  if (count === 0) return false;
  await db.activityLog.create({
    data: {
      action: "conference.organiser_removed",
      entityType: "Conference",
      entityId: conferenceId,
      actorId: admin.id,
      actorRole: admin.role,
      metadata: { userId },
    },
  });
  return true;
}

/** Organiser accounts that could be attached to a conference. */
export function findOrganiserAccounts() {
  return db.user.findMany({
    where: { role: "ORGANISER", status: { in: ["ACTIVE", "INVITED"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, status: true },
  });
}

// ── Payments and receipts (administrators) ─────────────────────────────────

async function allocateReceiptNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "ReceiptCounter" ("year", "lastValue") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "lastValue" = "ReceiptCounter"."lastValue" + 1
    RETURNING "lastValue"
  `;
  return `APR-R-${year}-${String(rows[0]!.lastValue).padStart(4, "0")}`;
}

/**
 * Records a payment an organiser made, and emails every organiser of the
 * conference a receipt for it.
 */
export async function recordPayment(
  admin: SessionUser,
  conferenceId: string,
  input: PaymentInput,
  /** The invoice this payment settles, which is then marked paid. */
  invoiceId?: string,
): Promise<{ ok: true; receiptNumber: string } | { ok: false; reason: "not_found" }> {
  const result = await db.$transaction(async (tx) => {
    const conference = await tx.conference.findUnique({
      where: { id: conferenceId },
      select: { id: true, name: true },
    });
    if (!conference) return { ok: false, reason: "not_found" } as const;

    const now = new Date();
    const receiptNumber = await allocateReceiptNumber(tx, now);
    const payment = await tx.payment.create({
      data: {
        conferenceId,
        amountMinor: input.amount,
        currency: input.currency,
        description: input.description,
        reference: input.reference,
        paidAt: input.paidAt,
        recordedById: admin.id,
        receiptNumber,
        receiptSentAt: now,
        invoiceId: invoiceId ?? null,
      },
      select: { id: true },
    });
    if (invoiceId) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: "PAID", paidAt: input.paidAt },
      });
    }

    const message = toOrganiser.paymentReceipt({
      conferenceId,
      conferenceName: conference.name,
      receiptNumber,
      amount: formatMoney(input.amount, input.currency),
      description: input.description,
      paidOn: formatDate(input.paidAt),
      reference: input.reference,
    });
    const organisers = await tx.conferenceOrganiser.findMany({
      where: { conferenceId },
      select: { userId: true },
    });
    await queueNotices(
      tx,
      organisers.map((row) => ({ userId: row.userId, message })),
    );

    await tx.activityLog.create({
      data: {
        action: "conference.payment_recorded",
        entityType: "Conference",
        entityId: conferenceId,
        actorId: admin.id,
        actorRole: admin.role,
        metadata: {
          paymentId: payment.id,
          receiptNumber,
          amountMinor: input.amount,
          currency: input.currency,
        },
      },
    });
    return { ok: true, receiptNumber } as const;
  });
  if (result.ok) kickEmailDispatch();
  return result;
}

// ── Papers (organisers) ────────────────────────────────────────────────────

export type PaperFilter = {
  status?: SubmissionStatus | "needs_reviewers";
  topic?: string;
  disciplineId?: string;
  query?: string;
};

const PAPER_ROW_SELECT = {
  id: true,
  reference: true,
  title: true,
  authorNames: true,
  institution: true,
  topic: true,
  paperType: true,
  status: true,
  submittedAt: true,
  disciplineOther: true,
  discipline: { select: { name: true } },
  assignments: {
    where: { status: { in: [...LIVE_ASSIGNMENT] } },
    select: {
      status: true,
      isTiebreaker: true,
      dueAt: true,
      review: { select: { score: true, recommend: true, status: true } },
    },
  },
} satisfies Prisma.SubmissionSelect;

export type PaperRowRecord = Prisma.SubmissionGetPayload<{ select: typeof PAPER_ROW_SELECT }>;

/** The submitted papers of a conference. Drafts stay private to their submitters. */
export async function findConferencePapers(
  conferenceId: string,
  filter: PaperFilter = {},
): Promise<PaperRowRecord[]> {
  const query = filter.query?.trim();
  const papers = await db.submission.findMany({
    where: {
      conferenceId,
      status:
        filter.status && filter.status !== "needs_reviewers"
          ? filter.status
          : filter.status === "needs_reviewers"
            ? { in: ["SUBMITTED", "UNDER_REVIEW"] }
            : { not: "DRAFT" },
      topic: filter.topic || undefined,
      disciplineId: filter.disciplineId || undefined,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { reference: { contains: query, mode: "insensitive" } },
              { authorNames: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    select: PAPER_ROW_SELECT,
  });

  if (filter.status !== "needs_reviewers") return papers;
  const conference = await db.conference.findUniqueOrThrow({
    where: { id: conferenceId },
    select: { reviewersPerPaper: true },
  });
  return papers.filter(
    (paper) =>
      paper.assignments.filter((assignment) => !assignment.isTiebreaker).length <
      conference.reviewersPerPaper,
  );
}

const PAPER_DETAIL_SELECT = {
  id: true,
  reference: true,
  title: true,
  authorNames: true,
  contactEmail: true,
  institution: true,
  topic: true,
  paperType: true,
  abstract: true,
  status: true,
  disciplineId: true,
  disciplineOther: true,
  discipline: { select: { name: true } },
  decisionNote: true,
  decidedAt: true,
  decidedBy: { select: { name: true } },
  submittedAt: true,
  createdAt: true,
  declarationAt: true,
  author: { select: { id: true, name: true, email: true, institution: true } },
  files: {
    where: { kind: "ORIGINAL" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, originalFilename: true, sizeBytes: true, storageKey: true },
  },
  assignments: {
    orderBy: { assignedAt: "asc" },
    select: {
      id: true,
      status: true,
      isTiebreaker: true,
      dueAt: true,
      assignedAt: true,
      acceptedAt: true,
      declinedAt: true,
      completedAt: true,
      declineReason: true,
      conflictDeclared: true,
      assignedBy: { select: { name: true } },
      reviewer: { select: { id: true, name: true, email: true, institution: true } },
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
            select: { id: true, originalFilename: true, sizeBytes: true },
          },
        },
      },
    },
  },
} satisfies Prisma.SubmissionSelect;

export type PaperDetailRecord = Prisma.SubmissionGetPayload<{ select: typeof PAPER_DETAIL_SELECT }>;

export function findConferencePaper(
  conferenceId: string,
  paperId: string,
): Promise<PaperDetailRecord | null> {
  return db.submission.findFirst({
    where: { id: paperId, conferenceId, status: { not: "DRAFT" } },
    select: PAPER_DETAIL_SELECT,
  });
}

export function findPaperActivity(paperId: string) {
  return db.activityLog.findMany({
    where: { entityType: "Submission", entityId: paperId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      action: true,
      createdAt: true,
      metadata: true,
      actor: { select: { name: true } },
      actorRole: true,
    },
  });
}

/** The paper, previewed for an organiser. */
export async function organiserPreview(conferenceId: string, paperId: string) {
  const file = await db.storedFile.findFirst({
    where: { kind: "ORIGINAL", submission: { id: paperId, conferenceId } },
    orderBy: { createdAt: "desc" },
    select: { storageKey: true, originalFilename: true, sizeBytes: true },
  });
  return file ? previewOf(file) : ({ type: "none" } as const);
}

/** A download link for a paper or a reviewer's marked-up copy, for an organiser. */
export async function organiserFileUrl(
  conferenceId: string,
  paperId: string,
  fileId: string,
): Promise<string | null> {
  const file = await db.storedFile.findFirst({
    where: { id: fileId, submission: { id: paperId, conferenceId } },
    select: { storageKey: true, originalFilename: true },
  });
  if (!file) return null;
  return storage().presignDownload({ key: file.storageKey, filename: file.originalFilename });
}

// ── Reviewers for a paper (organisers) ─────────────────────────────────────

/**
 * Every reviewer, with what an organiser needs to choose one by hand: their
 * workload in this conference, whether they work in the paper's discipline,
 * and whether they share an institution with it.
 */
export async function findReviewerOptions(conferenceId: string, paperId: string) {
  const paper = await db.submission.findFirstOrThrow({
    where: { id: paperId, conferenceId },
    select: {
      authorId: true,
      institution: true,
      disciplineId: true,
      author: { select: { institution: true } },
      assignments: { select: { reviewerId: true } },
    },
  });
  const [reviewers, loads] = await Promise.all([
    db.user.findMany({
      where: { role: "REVIEWER", status: "ACTIVE", id: { not: paper.authorId } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        institution: true,
        reviewerProfile: {
          select: { academicRank: true, disciplines: { select: { id: true, name: true } } },
        },
      },
    }),
    db.assignment.groupBy({
      by: ["reviewerId"],
      where: { status: { in: [...LIVE_ASSIGNMENT] }, submission: { conferenceId } },
      _count: { _all: true },
    }),
  ]);
  const loadOf = new Map(loads.map((row) => [row.reviewerId, row._count._all]));
  const alreadyAsked = new Set(paper.assignments.map((assignment) => assignment.reviewerId));

  return reviewers
    .filter((reviewer) => !alreadyAsked.has(reviewer.id))
    .map((reviewer) => {
      const disciplines = reviewer.reviewerProfile?.disciplines ?? [];
      return {
        id: reviewer.id,
        name: reviewer.name,
        institution: reviewer.institution,
        rank: reviewer.reviewerProfile?.academicRank ?? null,
        disciplines: disciplines.map((discipline) => discipline.name),
        matchesDiscipline:
          paper.disciplineId === null ||
          disciplines.some((discipline) => discipline.id === paper.disciplineId),
        conflict: sharesInstitution(reviewer.institution, [
          paper.institution,
          paper.author.institution,
        ]),
        load: loadOf.get(reviewer.id) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.matchesDiscipline) - Number(a.matchesDiscipline) ||
        Number(a.conflict) - Number(b.conflict) ||
        a.load - b.load,
    );
}

export type AssignResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_assignable" | "already_asked" | "not_a_reviewer" };

/**
 * An organiser gives a paper to a reviewer of their choosing. Workload and
 * institution rules are shown to them but not enforced: they may know
 * something the rules do not. The submitter can never review their own paper.
 */
export async function assignManually(
  organiser: SessionUser,
  conferenceId: string,
  paperId: string,
  reviewerId: string,
): Promise<AssignResult> {
  const paper = await db.submission.findFirst({
    where: { id: paperId, conferenceId },
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      authorId: true,
      conference: { select: { reviewDeadline: true } },
    },
  });
  if (!paper) return { ok: false, reason: "not_found" };
  if (!["SUBMITTED", "UNDER_REVIEW", "REVIEWS_COMPLETE"].includes(paper.status)) {
    return { ok: false, reason: "not_assignable" };
  }
  if (reviewerId === paper.authorId) return { ok: false, reason: "not_a_reviewer" };
  const reviewer = await db.user.count({
    where: { id: reviewerId, role: "REVIEWER", status: "ACTIVE" },
  });
  if (reviewer !== 1) return { ok: false, reason: "not_a_reviewer" };

  try {
    await db.$transaction(async (tx) => {
      const dueAt = dueDateFor(paper.conference.reviewDeadline);
      const assignment = await tx.assignment.create({
        data: { submissionId: paperId, reviewerId, assignedById: organiser.id, dueAt },
        select: { id: true },
      });
      await tx.activityLog.create({
        data: {
          action: "assignment.created",
          entityType: "Submission",
          entityId: paperId,
          actorId: organiser.id,
          actorRole: organiser.role,
          metadata: { assignmentId: assignment.id, reviewerId, automatic: false },
        },
      });
      await queueNotices(tx, [
        {
          userId: reviewerId,
          submissionId: paperId,
          message: toReviewer.assignmentReceived(
            { id: paper.id, reference: paper.reference, title: paper.title, conferenceId },
            formatDate(dueAt),
          ),
        },
      ]);
      if (paper.status !== "UNDER_REVIEW") {
        const moved = await transition({
          submissionId: paperId,
          event: paper.status === "SUBMITTED" ? "start_review" : "reopen_reviews",
          actor: organiser,
          tx,
        });
        if (!moved.ok) throw new Error(moved.reason);
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      return { ok: false, reason: "already_asked" };
    if (error instanceof Error && error.message === "changed_meanwhile") {
      return { ok: false, reason: "not_assignable" };
    }
    throw error;
  }
  kickEmailDispatch();
  return { ok: true };
}

/** An organiser takes a paper back from a reviewer who has not finished it. */
export async function removeReviewer(
  organiser: SessionUser,
  conferenceId: string,
  paperId: string,
  assignmentId: string,
): Promise<boolean> {
  const done = await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.findFirst({
      where: {
        id: assignmentId,
        submission: { id: paperId, conferenceId },
        status: { in: ["PENDING", "ACCEPTED"] },
      },
      select: {
        reviewerId: true,
        submission: { select: { id: true, reference: true, title: true } },
      },
    });
    if (!assignment) return false;

    await tx.assignment.update({
      where: { id: assignmentId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await tx.activityLog.create({
      data: {
        action: "assignment.cancelled",
        entityType: "Submission",
        entityId: paperId,
        actorId: organiser.id,
        actorRole: organiser.role,
        metadata: { assignmentId, reviewerId: assignment.reviewerId },
      },
    });
    await queueNotices(tx, [
      {
        userId: assignment.reviewerId,
        submissionId: paperId,
        message: toReviewer.assignmentCancelled({ ...assignment.submission, conferenceId }),
      },
    ]);
    await settleReviews(tx, paperId, organiser);
    return true;
  });
  if (done) kickEmailDispatch();
  return done;
}

// ── Deciding (organisers) ──────────────────────────────────────────────────

/**
 * Accepts or rejects a paper. Any review still open is cancelled, and its
 * reviewer told they no longer need to finish it. The submitter is emailed
 * the decision and can then read every submitted review.
 */
export async function decide(
  organiser: SessionUser,
  conferenceId: string,
  paperId: string,
  accepted: boolean,
  note: string,
  ip?: string | null,
): Promise<{ ok: true } | { ok: false; reason: TransitionFailure }> {
  const paper = await db.submission.findFirst({
    where: { id: paperId, conferenceId },
    select: { id: true, reference: true, title: true },
  });
  if (!paper) return { ok: false, reason: "not_found" };

  const decisionNote = note.trim().slice(0, 4000) || null;
  const result = await transition({
    submissionId: paperId,
    event: accepted ? "accept" : "reject",
    actor: organiser,
    ip,
    metadata: { note: decisionNote },
    apply: async (tx) => {
      await tx.submission.update({ where: { id: paperId }, data: { decisionNote } });
      const open = await tx.assignment.findMany({
        where: { submissionId: paperId, status: { in: ["PENDING", "ACCEPTED"] } },
        select: { id: true, reviewerId: true },
      });
      if (open.length === 0) return;
      await tx.assignment.updateMany({
        where: { id: { in: open.map((assignment) => assignment.id) } },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      const notices: Notice[] = open.map((assignment) => ({
        userId: assignment.reviewerId,
        submissionId: paperId,
        message: toReviewer.assignmentCancelled({ ...paper, conferenceId }),
      }));
      await queueNotices(tx, notices);
    },
  });
  return result.ok ? { ok: true } : result;
}
