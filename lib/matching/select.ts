/**
 * Choosing reviewers for a paper, as pure functions.
 *
 * The rules, in order:
 *
 *   1. Never the paper's own submitter, and never someone already asked to
 *      review it (including anyone who declined it).
 *   2. Never someone from the paper's institution, or the submitter's.
 *   3. Never someone already holding as many papers in this conference as the
 *      conference allows.
 *   4. Only reviewers who work in the paper's discipline. A paper whose
 *      discipline is not on the list ("Other") can go to anyone.
 *   5. Among those, the least busy first, so work spreads evenly; ties are
 *      broken at random, so the same people are not always first.
 *
 * The database work — loading candidates, holding the lock, writing the
 * assignments — is in lib/matching/index.ts. Keeping the choice itself here
 * means every rule above is tested without a database.
 */

export type Candidate = {
  id: string;
  institution: string | null;
  disciplineIds: string[];
  /** Papers this reviewer already holds or has reviewed in this conference. */
  load: number;
};

/**
 * Institution names as typed by people vary in case, spacing and
 * punctuation. This folds those differences so "University of Lagos" and
 * "university of lagos." count as the same place.
 */
export function normaliseInstitution(name: string | null | undefined): string | null {
  if (!name) return null;
  const folded = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return folded || null;
}

export function sharesInstitution(
  candidate: string | null,
  excluded: Array<string | null | undefined>,
): boolean {
  const mine = normaliseInstitution(candidate);
  if (!mine) return false;
  return excluded.some((other) => normaliseInstitution(other) === mine);
}

export function eligibleReviewers(input: {
  candidates: Candidate[];
  /** The paper's discipline, or null when it is "Other". */
  disciplineId: string | null;
  /** The paper's institution and its submitter's. */
  excludedInstitutions: Array<string | null | undefined>;
  /** Everyone who must not be picked: the submitter and anyone already asked. */
  excludedIds: string[];
  maxLoad: number;
}): Candidate[] {
  const excluded = new Set(input.excludedIds);
  return input.candidates.filter(
    (candidate) =>
      !excluded.has(candidate.id) &&
      candidate.load < input.maxLoad &&
      !sharesInstitution(candidate.institution, input.excludedInstitutions) &&
      (input.disciplineId === null || candidate.disciplineIds.includes(input.disciplineId)),
  );
}

/** Picks up to `needed` reviewers: least busy first, ties broken at random. */
export function pickReviewers(
  eligible: Candidate[],
  needed: number,
  random: () => number = Math.random,
): string[] {
  if (needed <= 0) return [];
  return eligible
    .map((candidate) => ({ candidate, tiebreak: random() }))
    .sort((a, b) => a.candidate.load - b.candidate.load || a.tiebreak - b.tiebreak)
    .slice(0, needed)
    .map(({ candidate }) => candidate.id);
}

export type FinishedReview = { score: number; recommend: boolean };

/**
 * Whether the reviews of a paper disagree enough to need another reviewer:
 * one recommends it and another does not, or their scores are two or more
 * points apart. A single review cannot disagree with itself.
 */
export function needsTiebreaker(reviews: FinishedReview[]): boolean {
  if (reviews.length < 2) return false;
  const recommendations = new Set(reviews.map((review) => review.recommend));
  if (recommendations.size > 1) return true;
  const scores = reviews.map((review) => review.score);
  return Math.max(...scores) - Math.min(...scores) >= 2;
}

/**
 * The due date for a new assignment: the conference's review deadline, or a
 * week from now if the paper reaches someone late (after a decline, say), so
 * nobody is ever handed a review that is already overdue.
 */
export function dueDateFor(reviewDeadline: Date, now: Date = new Date()): Date {
  const aWeekFromNow = new Date(now.getTime() + 7 * 86_400_000);
  return reviewDeadline.getTime() > aWeekFromNow.getTime() ? reviewDeadline : aWeekFromNow;
}
