// @vitest-environment node
import { describe, expect, it } from "vitest";
import { countBy, csvCell, reviewerProgress, summarise, toCsv } from "./reports";

describe("countBy", () => {
  it("counts, largest first, ties alphabetical", () => {
    expect(countBy(["b", "a", "b", "c", "a"], (x) => x)).toEqual([
      { label: "a", count: 2 },
      { label: "b", count: 2 },
      { label: "c", count: 1 },
    ]);
  });
});

describe("summarise", () => {
  it("counts acceptance among decided papers only, and averages every score", () => {
    const summary = summarise([
      { status: "ACCEPTED", topic: "A", discipline: "X", paperType: "REVIEW", scores: [5, 4] },
      { status: "REJECTED", topic: "A", discipline: "X", paperType: "REVIEW", scores: [2] },
      { status: "UNDER_REVIEW", topic: "B", discipline: "Y", paperType: "CONCEPTUAL", scores: [] },
      { status: "WITHDRAWN", topic: "B", discipline: "Y", paperType: "CONCEPTUAL", scores: [] },
      { status: "DRAFT", topic: "C", discipline: "Z", paperType: "CONCEPTUAL", scores: [] },
    ]);
    expect(summary).toMatchObject({
      submitted: 3,
      decided: 2,
      accepted: 1,
      rejected: 1,
      acceptanceRate: 50,
      averageScore: 3.7,
    });
    expect(summary.byTopic).toEqual([
      { label: "A", count: 2 },
      { label: "B", count: 2 },
    ]);
  });

  it("reports no rate or average before there is anything to measure", () => {
    expect(summarise([])).toMatchObject({ acceptanceRate: null, averageScore: null });
  });
});

describe("reviewerProgress", () => {
  it("counts work per reviewer, overdue first", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const past = new Date("2026-10-01T00:00:00Z");
    const future = new Date("2026-10-20T00:00:00Z");
    const rows = reviewerProgress(
      [
        { reviewerId: "1", name: "Ann", status: "COMPLETED", dueAt: past },
        { reviewerId: "1", name: "Ann", status: "ACCEPTED", dueAt: future },
        { reviewerId: "2", name: "Ben", status: "PENDING", dueAt: past },
        { reviewerId: "2", name: "Ben", status: "DECLINED", dueAt: past },
      ],
      now,
    );
    expect(rows).toEqual([
      { reviewerId: "2", name: "Ben", assigned: 1, completed: 0, open: 1, overdue: 1, declined: 1 },
      { reviewerId: "1", name: "Ann", assigned: 2, completed: 1, open: 1, overdue: 0, declined: 0 },
    ]);
  });
});

describe("CSV", () => {
  it("quotes only what must be quoted", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", then go')).toBe('"say ""hi"", then go"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(4.5)).toBe("4.5");
  });

  it("never lets a typed value run as a spreadsheet formula", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-3)).toBe("-3");
  });

  it("starts with a byte-order mark and uses CRLF, so Excel reads UTF-8", () => {
    const csv = toCsv(["Name"], [["Adébáyọ̀"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿Name\r\nAdébáyọ̀\r\n");
  });
});
