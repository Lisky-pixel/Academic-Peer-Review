import { db } from "@/lib/db";
import type { PaperType, SubmissionStatus } from "@/lib/generated/prisma/client";
import { LIVE_ASSIGNMENT } from "@/lib/matching";
import { PAPER_TYPE_LABEL } from "@/lib/submissions/schema";
import { STATUS_LABEL } from "@/lib/submissions/stage";

/**
 * Reports and exports for one conference. The counting is done by pure
 * functions over plain rows, so it is tested without a database; the queries
 * that feed them are at the bottom.
 */

export type Count = { label: string; count: number };

/** Counts by a key, largest first, ties alphabetical. */
export function countBy<T>(rows: T[], key: (row: T) => string): Count[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type PaperFacts = {
  status: SubmissionStatus;
  topic: string;
  discipline: string;
  paperType: PaperType;
  scores: number[];
};

export type ConferenceSummary = {
  submitted: number;
  decided: number;
  accepted: number;
  rejected: number;
  /** Accepted as a share of decided papers, 0–100, or null before any decision. */
  acceptanceRate: number | null;
  averageScore: number | null;
  byStatus: Count[];
  byTopic: Count[];
  byDiscipline: Count[];
  byType: Count[];
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarise(papers: PaperFacts[]): ConferenceSummary {
  const inPlay = papers.filter((paper) => paper.status !== "DRAFT");
  const accepted = inPlay.filter((paper) => paper.status === "ACCEPTED").length;
  const rejected = inPlay.filter((paper) => paper.status === "REJECTED").length;
  const decided = accepted + rejected;
  const scores = inPlay.flatMap((paper) => paper.scores);

  return {
    submitted: inPlay.filter((paper) => paper.status !== "WITHDRAWN").length,
    decided,
    accepted,
    rejected,
    acceptanceRate: decided > 0 ? Math.round((accepted / decided) * 100) : null,
    averageScore:
      scores.length > 0 ? round1(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null,
    byStatus: countBy(inPlay, (paper) => STATUS_LABEL[paper.status]),
    byTopic: countBy(inPlay, (paper) => paper.topic),
    byDiscipline: countBy(inPlay, (paper) => paper.discipline),
    byType: countBy(inPlay, (paper) => PAPER_TYPE_LABEL[paper.paperType]),
  };
}

export type ReviewerProgress = {
  reviewerId: string;
  name: string;
  assigned: number;
  completed: number;
  open: number;
  overdue: number;
  declined: number;
};

export function reviewerProgress(
  rows: Array<{
    reviewerId: string;
    name: string;
    status: string;
    dueAt: Date;
  }>,
  now: Date,
): ReviewerProgress[] {
  const byReviewer = new Map<string, ReviewerProgress>();
  for (const row of rows) {
    const entry = byReviewer.get(row.reviewerId) ?? {
      reviewerId: row.reviewerId,
      name: row.name,
      assigned: 0,
      completed: 0,
      open: 0,
      overdue: 0,
      declined: 0,
    };
    if (row.status === "DECLINED") entry.declined += 1;
    if ((LIVE_ASSIGNMENT as readonly string[]).includes(row.status)) entry.assigned += 1;
    if (row.status === "COMPLETED") entry.completed += 1;
    if (row.status === "PENDING" || row.status === "ACCEPTED") {
      entry.open += 1;
      if (row.dueAt < now) entry.overdue += 1;
    }
    byReviewer.set(row.reviewerId, entry);
  }
  return [...byReviewer.values()].sort(
    (a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name),
  );
}

// ── CSV ────────────────────────────────────────────────────────────────────

/**
 * One CSV cell. Quoted when it must be; and a value that a spreadsheet would
 * run as a formula (=, +, -, @, tab, return at the start) is prefixed with an
 * apostrophe. Paper titles and comments are typed by the public, so opening
 * an export must never execute something they wrote.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A whole CSV file. Starts with a byte-order mark and uses CRLF, which is
 * what makes Excel open it as UTF-8 with names like "Adébáyọ̀" intact.
 */
export function toCsv(header: string[], rows: Array<Array<string | number | boolean | null>>) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function findConferenceReport(conferenceId: string, now: Date = new Date()) {
  const [papers, assignments] = await Promise.all([
    db.submission.findMany({
      where: { conferenceId, status: { not: "DRAFT" } },
      select: {
        status: true,
        topic: true,
        paperType: true,
        disciplineOther: true,
        discipline: { select: { name: true } },
        reviews: { where: { status: "SUBMITTED" }, select: { score: true } },
      },
    }),
    db.assignment.findMany({
      where: { submission: { conferenceId } },
      select: {
        reviewerId: true,
        status: true,
        dueAt: true,
        reviewer: { select: { name: true } },
      },
    }),
  ]);

  return {
    summary: summarise(
      papers.map((paper) => ({
        status: paper.status,
        topic: paper.topic,
        discipline: paper.discipline?.name ?? paper.disciplineOther ?? "Other",
        paperType: paper.paperType,
        scores: paper.reviews.map((review) => review.score ?? 0).filter((score) => score > 0),
      })),
    ),
    reviewers: reviewerProgress(
      assignments.map((assignment) => ({
        reviewerId: assignment.reviewerId,
        name: assignment.reviewer.name,
        status: assignment.status,
        dueAt: assignment.dueAt,
      })),
      now,
    ),
  };
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

/** Every submitted paper, one row each, for organisers. */
export async function exportPapers(conferenceId: string): Promise<string> {
  const papers = await db.submission.findMany({
    where: { conferenceId, status: { not: "DRAFT" } },
    orderBy: { submittedAt: "asc" },
    select: {
      reference: true,
      title: true,
      authorNames: true,
      contactEmail: true,
      institution: true,
      topic: true,
      paperType: true,
      disciplineOther: true,
      discipline: { select: { name: true } },
      status: true,
      submittedAt: true,
      decidedAt: true,
      abstract: true,
      reviews: { where: { status: "SUBMITTED" }, select: { score: true, recommend: true } },
    },
  });

  return toCsv(
    [
      "Reference",
      "Title",
      "Authors",
      "Contact email",
      "Institution",
      "Topic",
      "Discipline",
      "Type",
      "Status",
      "Submitted",
      "Reviews in",
      "Average score",
      "Recommended by",
      "Decided",
      "Abstract",
    ],
    papers.map((paper) => {
      const scores = paper.reviews.map((review) => review.score ?? 0).filter(Boolean);
      return [
        paper.reference,
        paper.title,
        paper.authorNames,
        paper.contactEmail,
        paper.institution,
        paper.topic,
        paper.discipline?.name ?? paper.disciplineOther ?? "Other",
        PAPER_TYPE_LABEL[paper.paperType],
        STATUS_LABEL[paper.status],
        iso(paper.submittedAt),
        paper.reviews.length,
        scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        paper.reviews.filter((review) => review.recommend).length,
        iso(paper.decidedAt),
        paper.abstract,
      ];
    }),
  );
}

/** Every review, one row each, with the reviewer named — organisers only. */
export async function exportReviews(conferenceId: string): Promise<string> {
  const assignments = await db.assignment.findMany({
    where: { submission: { conferenceId } },
    orderBy: [{ submission: { reference: "asc" } }, { assignedAt: "asc" }],
    select: {
      status: true,
      isTiebreaker: true,
      assignedAt: true,
      dueAt: true,
      completedAt: true,
      declineReason: true,
      conflictDeclared: true,
      reviewer: { select: { name: true, email: true, institution: true } },
      submission: { select: { reference: true, title: true } },
      review: { select: { score: true, recommend: true, comments: true, status: true } },
    },
  });

  const STATUS: Record<string, string> = {
    PENDING: "Not yet answered",
    ACCEPTED: "In progress",
    DECLINED: "Declined",
    CANCELLED: "Removed",
    COMPLETED: "Submitted",
  };

  return toCsv(
    [
      "Paper",
      "Title",
      "Reviewer",
      "Reviewer email",
      "Reviewer institution",
      "Status",
      "Tie-breaker",
      "Assigned",
      "Due",
      "Submitted",
      "Score (1-5)",
      "Recommends",
      "Comments",
      "Declined because",
    ],
    assignments.map((assignment) => {
      const submitted = assignment.review?.status === "SUBMITTED";
      return [
        assignment.submission.reference,
        assignment.submission.title,
        assignment.reviewer.name,
        assignment.reviewer.email,
        assignment.reviewer.institution,
        STATUS[assignment.status] ?? assignment.status,
        assignment.isTiebreaker ? "Yes" : "No",
        iso(assignment.assignedAt),
        iso(assignment.dueAt),
        iso(assignment.completedAt),
        submitted ? (assignment.review?.score ?? null) : null,
        submitted ? (assignment.review?.recommend ? "Yes" : "No") : null,
        submitted ? (assignment.review?.comments ?? null) : null,
        assignment.conflictDeclared
          ? `Conflict of interest${assignment.declineReason ? `: ${assignment.declineReason}` : ""}`
          : assignment.declineReason,
      ];
    }),
  );
}
