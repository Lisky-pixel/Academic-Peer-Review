import type { CriterionInputType } from "@/lib/generated/prisma/client";

/**
 * Whether a review is finished enough to submit. Pure, so the same rule runs
 * on the server (which decides) and in the form (which explains).
 */

export type Criterion = {
  id: string;
  label: string;
  inputType: CriterionInputType;
  maxRating: number;
  required: boolean;
};

export type Answer = { rating: number | null; comment: string | null };

export const COMMENT_MAX = 5000;

/**
 * A rating criterion is answered by its rating; a text criterion by its
 * comment. On a "both" criterion the rating is what is required — a comment
 * is welcome but a score alone is a complete answer.
 */
export function isAnswered(criterion: Criterion, answer: Answer | undefined): boolean {
  if (criterion.inputType === "TEXT") return Boolean(answer?.comment?.trim());
  return (
    typeof answer?.rating === "number" && answer.rating >= 1 && answer.rating <= criterion.maxRating
  );
}

/** The required criteria that still need an answer, in template order. */
export function unansweredCriteria(
  criteria: Criterion[],
  answers: Record<string, Answer | undefined>,
): Criterion[] {
  return criteria.filter(
    (criterion) => criterion.required && !isAnswered(criterion, answers[criterion.id]),
  );
}

export type AnswerInput = { criterionId: string; rating: unknown; comment: unknown };

/**
 * Cleans one answer arriving from the browser, or returns null if it does
 * not belong to this template. A rating outside the criterion's scale, or on
 * a text-only criterion, is dropped rather than stored.
 */
export function normaliseAnswer(
  criteria: Criterion[],
  input: AnswerInput,
): { criterionId: string; rating: number | null; comment: string | null } | null {
  const criterion = criteria.find((candidate) => candidate.id === input.criterionId);
  if (!criterion) return null;

  const acceptsRating = criterion.inputType !== "TEXT";
  const acceptsComment = criterion.inputType !== "RATING";

  const rating =
    acceptsRating &&
    typeof input.rating === "number" &&
    Number.isInteger(input.rating) &&
    input.rating >= 1 &&
    input.rating <= criterion.maxRating
      ? input.rating
      : null;

  const text = acceptsComment && typeof input.comment === "string" ? input.comment.trim() : "";
  const comment = text ? text.slice(0, COMMENT_MAX) : null;

  return { criterionId: criterion.id, rating, comment };
}
