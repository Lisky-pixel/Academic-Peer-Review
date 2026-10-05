import { db } from "@/lib/db";
import type { SubmissionStatus } from "@/lib/generated/prisma/client";

/**
 * The numbers behind the admin dashboard and the reports page. Everything is
 * computed from real rows on request; there are no stored aggregates to drift
 * out of date. The arithmetic is in small pure functions so it can be tested
 * without a database.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// ── Pure arithmetic ────────────────────────────────────────────────────────

/** Midnight UTC on the Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS);
}

export type WeekBucket = { weekStart: string; count: number };

/**
 * Counts dates into the last `weeks` calendar weeks, ending with the current
 * one. Weeks with nothing in them are present with a count of zero, so a
 * chart of the result shows gaps as gaps instead of closing them up.
 */
export function bucketByWeek(dates: Date[], weeks: number, now: Date): WeekBucket[] {
  const thisWeek = startOfWeek(now).getTime();
  const buckets = Array.from({ length: weeks }, (_, index) => ({
    start: thisWeek - (weeks - 1 - index) * WEEK_MS,
    count: 0,
  }));

  for (const date of dates) {
    const index = Math.floor((startOfWeek(date).getTime() - buckets[0]!.start) / WEEK_MS);
    if (index >= 0 && index < weeks) buckets[index]!.count++;
  }

  return buckets.map((bucket) => ({
    weekStart: new Date(bucket.start).toISOString(),
    count: bucket.count,
  }));
}

export type DurationSummary = {
  count: number;
  averageDays: number | null;
  medianDays: number | null;
};

/** Average and median of a list of durations, in days to one decimal place. */
export function summariseDurations(durationsMs: number[]): DurationSummary {
  const valid = durationsMs.filter((ms) => Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
  if (valid.length === 0) return { count: 0, averageDays: null, medianDays: null };

  const toDays = (ms: number) => Math.round((ms / DAY_MS) * 10) / 10;
  const middle = Math.floor(valid.length / 2);
  const median = valid.length % 2 ? valid[middle]! : (valid[middle - 1]! + valid[middle]!) / 2;

  return {
    count: valid.length,
    averageDays: toDays(valid.reduce((sum, ms) => sum + ms, 0) / valid.length),
    medianDays: toDays(median),
  };
}

// ── Dashboard counts ───────────────────────────────────────────────────────

export type AdminCounts = {
  needsReviewer: number;
  withReviewers: number;
  needsApproval: number;
  /** Approved, but the author has not opened it yet. */
  awaitingCollection: number;
  delivered: number;
  /** Reviews in progress that are past their due date. */
  overdueReviews: number;
};

const WITH_REVIEWERS: SubmissionStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_REVIEW",
  "REVISION_REQUESTED",
];

export async function findAdminCounts(now: Date = new Date()): Promise<AdminCounts> {
  const [byStatus, overdueReviews] = await Promise.all([
    db.submission.groupBy({ by: ["status"], _count: { _all: true } }),
    db.assignment.count({
      where: {
        isActive: true,
        status: { in: ["PENDING", "ACCEPTED"] },
        dueAt: { lt: now },
        submission: { status: { in: WITH_REVIEWERS } },
      },
    }),
  ]);
  const count = (...statuses: SubmissionStatus[]) =>
    byStatus
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

  return {
    needsReviewer: count("PENDING_ASSIGNMENT"),
    withReviewers: count(...WITH_REVIEWERS),
    needsApproval: count("UNDER_ADMIN_REVIEW"),
    awaitingCollection: count("APPROVED"),
    delivered: count("DELIVERED"),
    overdueReviews,
  };
}

// ── Reports ────────────────────────────────────────────────────────────────

export const REPORT_WEEKS = 12;
export const REPORT_DAYS = 90;

export type Reports = {
  /** Submissions received per week, oldest first. */
  perWeek: WeekBucket[];
  /** Submitted to approved, for reviews approved in the period. */
  turnaround: DurationSummary;
  turnaroundByType: Array<{ documentType: string } & DurationSummary>;
  reviewers: Array<{
    id: string;
    name: string;
    /** Reviews submitted in the period. */
    completed: number;
    /** Assigned to first submitted, averaged. */
    averageDays: number | null;
    open: number;
    overdue: number;
  }>;
};

export async function findReports(now: Date = new Date()): Promise<Reports> {
  const weeksStart = new Date(startOfWeek(now).getTime() - (REPORT_WEEKS - 1) * WEEK_MS);
  const periodStart = new Date(now.getTime() - REPORT_DAYS * DAY_MS);

  const [submitted, approved, reviewers] = await Promise.all([
    db.submission.findMany({
      where: { submittedAt: { gte: weeksStart } },
      select: { submittedAt: true },
    }),
    db.submission.findMany({
      where: { approvedAt: { gte: periodStart }, submittedAt: { not: null } },
      select: { submittedAt: true, approvedAt: true, documentType: { select: { name: true } } },
    }),
    db.user.findMany({
      where: { role: "REVIEWER", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        assignmentsToReview: {
          where: {
            OR: [
              { isActive: true, status: { in: ["PENDING", "ACCEPTED"] } },
              { review: { submittedAt: { gte: periodStart } } },
            ],
          },
          select: {
            isActive: true,
            status: true,
            dueAt: true,
            assignedAt: true,
            review: { select: { submittedAt: true } },
            submission: { select: { status: true } },
          },
        },
      },
    }),
  ]);

  const durations = approved.map((row) => ({
    documentType: row.documentType.name,
    ms: row.approvedAt!.getTime() - row.submittedAt!.getTime(),
  }));
  const types = [...new Set(durations.map((row) => row.documentType))].sort();

  return {
    perWeek: bucketByWeek(
      submitted.map((row) => row.submittedAt!),
      REPORT_WEEKS,
      now,
    ),
    turnaround: summariseDurations(durations.map((row) => row.ms)),
    turnaroundByType: types.map((documentType) => ({
      documentType,
      ...summariseDurations(
        durations.filter((row) => row.documentType === documentType).map((row) => row.ms),
      ),
    })),
    reviewers: reviewers.map((reviewer) => {
      const done = reviewer.assignmentsToReview.filter(
        (assignment) =>
          assignment.review?.submittedAt && assignment.review.submittedAt >= periodStart,
      );
      const open = reviewer.assignmentsToReview.filter(
        (assignment) =>
          assignment.isActive &&
          (assignment.status === "PENDING" || assignment.status === "ACCEPTED") &&
          WITH_REVIEWERS.includes(assignment.submission.status),
      );
      return {
        id: reviewer.id,
        name: reviewer.name,
        completed: done.length,
        averageDays: summariseDurations(
          done.map(
            (assignment) =>
              assignment.review!.submittedAt!.getTime() - assignment.assignedAt.getTime(),
          ),
        ).averageDays,
        open: open.length,
        overdue: open.filter((assignment) => assignment.dueAt && assignment.dueAt < now).length,
      };
    }),
  };
}
