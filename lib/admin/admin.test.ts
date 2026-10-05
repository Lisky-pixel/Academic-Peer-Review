// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bucketByWeek, startOfWeek, summariseDurations } from "@/lib/admin/reports";
import {
  criteriaSchema,
  type CriterionInput,
  MAX_CRITERIA,
  sameCriteria,
  slugify,
  STARTER_CRITERIA,
} from "@/lib/admin/template-schema";

const DAY = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe("startOfWeek", () => {
  it.each([
    ["a Monday", "2026-10-05", "2026-10-05"],
    ["a Wednesday", "2026-10-07", "2026-10-05"],
    ["a Sunday, which belongs to the week that began six days earlier", "2026-10-11", "2026-10-05"],
    ["a week that began in the previous month", "2026-10-01", "2026-09-28"],
    ["a week that began in the previous year", "2027-01-02", "2026-12-28"],
  ])("%s", (_label, date, monday) => {
    expect(startOfWeek(utc(date)).toISOString()).toBe(`${monday}T00:00:00.000Z`);
  });
});

describe("bucketByWeek", () => {
  const now = utc("2026-10-07"); // week of Monday 5 October

  it("returns the requested number of weeks, oldest first, ending with this week", () => {
    const buckets = bucketByWeek([], 4, now);

    expect(buckets.map((bucket) => bucket.weekStart.slice(0, 10))).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
    ]);
  });

  it("keeps empty weeks as zero instead of dropping them", () => {
    const buckets = bucketByWeek([utc("2026-09-15"), utc("2026-10-06")], 4, now);

    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 0, 0, 1]);
  });

  it("counts a Sunday in its own week and the next Monday in the following one", () => {
    const buckets = bucketByWeek(
      [new Date("2026-10-04T23:59:59.000Z"), new Date("2026-10-05T00:00:00.000Z")],
      2,
      now,
    );

    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1]);
  });

  it("ignores anything outside the window, before or after", () => {
    const buckets = bucketByWeek([utc("2026-01-01"), utc("2026-12-25")], 4, now);

    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(0);
  });
});

describe("summariseDurations", () => {
  it("reports nothing rather than zero when there is no data", () => {
    expect(summariseDurations([])).toEqual({ count: 0, averageDays: null, medianDays: null });
  });

  it("gives the average and the median in days", () => {
    expect(summariseDurations([1 * DAY, 2 * DAY, 9 * DAY])).toEqual({
      count: 3,
      averageDays: 4,
      medianDays: 2,
    });
  });

  it("takes the midpoint of the two middle values for an even count", () => {
    expect(summariseDurations([1 * DAY, 2 * DAY, 4 * DAY, 10 * DAY]).medianDays).toBe(3);
  });

  it("rounds to one decimal place", () => {
    expect(summariseDurations([DAY / 3]).averageDays).toBe(0.3);
  });

  it("ignores negative and non-numeric durations, which can only be bad data", () => {
    expect(summariseDurations([-5 * DAY, Number.NaN, 2 * DAY])).toMatchObject({
      count: 1,
      averageDays: 2,
    });
  });
});

describe("criteriaSchema", () => {
  const criterion = (overrides: Partial<Record<keyof CriterionInput, unknown>> = {}) => ({
    label: "Clarity",
    helpText: "Is it clear?",
    inputType: "BOTH",
    required: true,
    ...overrides,
  });

  it("accepts the starter template", () => {
    expect(criteriaSchema.safeParse(STARTER_CRITERIA).success).toBe(true);
  });

  it("trims names and stores blank guidance as nothing", () => {
    const parsed = criteriaSchema.parse([criterion({ label: "  Clarity ", helpText: "   " })]);

    expect(parsed[0]).toMatchObject({ label: "Clarity", helpText: null });
  });

  it.each([
    ["no criteria at all", []],
    ["a criterion with no name", [criterion({ label: " " })]],
    ["an answer type that does not exist", [criterion({ inputType: "STARS" })]],
    ["a required flag that is not a boolean", [criterion({ required: "yes" })]],
    ["nothing required", [criterion({ required: false })]],
    [
      "two criteria with the same name in different case",
      [criterion(), criterion({ label: "CLARITY" })],
    ],
    [
      "more criteria than the limit",
      Array.from({ length: MAX_CRITERIA + 1 }, (_, i) => criterion({ label: `Criterion ${i}` })),
    ],
    ["something that is not a list", { label: "Clarity" }],
  ])("refuses %s", (_label, input) => {
    expect(criteriaSchema.safeParse(input).success).toBe(false);
  });
});

describe("sameCriteria", () => {
  const base = criteriaSchema.parse(STARTER_CRITERIA);

  it("is true for identical lists, treating missing guidance as none", () => {
    expect(
      sameCriteria(
        base,
        base.map((c) => ({ ...c })),
      ),
    ).toBe(true);
    expect(sameCriteria([{ ...base[0]!, helpText: null }], [{ ...base[0]!, helpText: null }])).toBe(
      true,
    );
  });

  it.each([
    ["a renamed criterion", base.map((c, i) => (i === 0 ? { ...c, label: "Spelling" } : c))],
    ["changed guidance", base.map((c, i) => (i === 0 ? { ...c, helpText: "New" } : c))],
    ["a changed answer type", base.map((c, i) => (i === 0 ? { ...c, inputType: "RATING" } : c))],
    ["a criterion made optional", base.map((c, i) => (i === 0 ? { ...c, required: false } : c))],
    ["a reordering", [base[1]!, base[0]!, ...base.slice(2)]],
    ["a removal", base.slice(1)],
  ])("is false for %s", (_label, changed) => {
    expect(sameCriteria(base, changed)).toBe(false);
  });
});

describe("slugify", () => {
  it.each([
    ["Cover Letter", "cover-letter"],
    ["CV/Resume", "cv-resume"],
    ["  Grant   Application (EU) ", "grant-application-eu"],
    ["Résumé", "resume"],
    ["!!!", ""],
  ])("%j → %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});
