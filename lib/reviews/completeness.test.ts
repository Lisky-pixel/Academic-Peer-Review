import { describe, expect, it } from "vitest";
import {
  COMMENT_MAX,
  type Criterion,
  isAnswered,
  normaliseAnswer,
  unansweredCriteria,
} from "@/lib/reviews/completeness";

const criterion = (overrides: Partial<Criterion> = {}): Criterion => ({
  id: "c1",
  label: "Clarity",
  inputType: "BOTH",
  maxRating: 5,
  required: true,
  ...overrides,
});

describe("isAnswered", () => {
  it("needs a rating on a rating criterion, and accepts the whole scale", () => {
    const rating = criterion({ inputType: "RATING" });

    expect(isAnswered(rating, undefined)).toBe(false);
    expect(isAnswered(rating, { rating: null, comment: "Lovely" })).toBe(false);
    expect(isAnswered(rating, { rating: 1, comment: null })).toBe(true);
    expect(isAnswered(rating, { rating: 5, comment: null })).toBe(true);
  });

  it.each([0, 6, -1])("rejects a rating of %d on a five-point scale", (rating) => {
    expect(isAnswered(criterion(), { rating, comment: null })).toBe(false);
  });

  it("needs the rating, not the comment, when a criterion takes both", () => {
    expect(isAnswered(criterion(), { rating: 4, comment: null })).toBe(true);
    expect(isAnswered(criterion(), { rating: null, comment: "Good but no score" })).toBe(false);
  });

  it("needs real text on a text criterion — whitespace does not count", () => {
    const text = criterion({ inputType: "TEXT" });

    expect(isAnswered(text, { rating: null, comment: "   \n " })).toBe(false);
    expect(isAnswered(text, { rating: 5, comment: null })).toBe(false);
    expect(isAnswered(text, { rating: null, comment: "Merge paragraphs two and three." })).toBe(
      true,
    );
  });
});

describe("unansweredCriteria", () => {
  const criteria = [
    criterion({ id: "a", label: "Grammar" }),
    criterion({ id: "b", label: "Clarity" }),
    criterion({ id: "c", label: "Nice to have", required: false }),
    criterion({ id: "d", label: "Overall feedback", inputType: "TEXT" }),
  ];

  it("lists what is missing, in template order, ignoring optional criteria", () => {
    const missing = unansweredCriteria(criteria, { b: { rating: 3, comment: null } });

    expect(missing.map((c) => c.label)).toEqual(["Grammar", "Overall feedback"]);
  });

  it("is empty when every required criterion is answered", () => {
    const answers = {
      a: { rating: 5, comment: null },
      b: { rating: 3, comment: "Wordy in places." },
      d: { rating: null, comment: "A strong, specific story." },
    };

    expect(unansweredCriteria(criteria, answers)).toEqual([]);
  });
});

describe("normaliseAnswer", () => {
  const criteria = [
    criterion({ id: "both" }),
    criterion({ id: "rating", inputType: "RATING" }),
    criterion({ id: "text", inputType: "TEXT" }),
  ];

  it("drops an answer for a criterion that is not in this template", () => {
    expect(normaliseAnswer(criteria, { criterionId: "other", rating: 5, comment: "x" })).toBeNull();
  });

  it("trims comments and stores an empty one as nothing", () => {
    expect(
      normaliseAnswer(criteria, { criterionId: "both", rating: 4, comment: "  ok  " }),
    ).toEqual({ criterionId: "both", rating: 4, comment: "ok" });
    expect(
      normaliseAnswer(criteria, { criterionId: "both", rating: 4, comment: "   " })?.comment,
    ).toBeNull();
  });

  it.each([0, 6, 2.5, "5", null, undefined, Number.NaN])(
    "stores a rating of %j as no rating",
    (rating) => {
      expect(normaliseAnswer(criteria, { criterionId: "both", rating, comment: "" })?.rating).toBe(
        null,
      );
    },
  );

  it("ignores a rating on a text criterion and a comment on a rating criterion", () => {
    expect(normaliseAnswer(criteria, { criterionId: "text", rating: 5, comment: "Text" })).toEqual({
      criterionId: "text",
      rating: null,
      comment: "Text",
    });
    expect(normaliseAnswer(criteria, { criterionId: "rating", rating: 5, comment: "No" })).toEqual({
      criterionId: "rating",
      rating: 5,
      comment: null,
    });
  });

  it("caps an enormous comment", () => {
    const result = normaliseAnswer(criteria, {
      criterionId: "text",
      rating: null,
      comment: "x".repeat(COMMENT_MAX + 500),
    });

    expect(result?.comment).toHaveLength(COMMENT_MAX);
  });

  it("treats a non-string comment as no comment", () => {
    expect(
      normaliseAnswer(criteria, { criterionId: "text", rating: null, comment: { evil: true } })
        ?.comment,
    ).toBeNull();
  });
});
