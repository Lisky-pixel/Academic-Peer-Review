import { describe, expect, it } from "vitest";
import type { SubmissionStatus } from "@/lib/generated/prisma/client";
import { type Capacity, decideTransition, TRANSITIONS, type WorkflowEvent } from "./transitions";

const ALL: SubmissionStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "REVIEWS_COMPLETE",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
];

describe("the paper lifecycle", () => {
  it("lets a submitter submit their draft, and nobody else", () => {
    expect(decideTransition("DRAFT", "submit", ["SUBMITTER"])).toEqual({
      ok: true,
      to: "SUBMITTED",
      as: "SUBMITTER",
    });
    expect(decideTransition("DRAFT", "submit", ["ORGANISER"])).toMatchObject({ ok: false });
    expect(decideTransition("SUBMITTED", "submit", ["SUBMITTER"])).toMatchObject({
      ok: false,
      reason: "illegal_from_this_status",
    });
  });

  it("sends a paper to review only by organiser or system", () => {
    expect(decideTransition("SUBMITTED", "start_review", ["SYSTEM"])).toMatchObject({ ok: true });
    expect(decideTransition("SUBMITTED", "start_review", ["ORGANISER"])).toMatchObject({
      ok: true,
    });
    expect(decideTransition("SUBMITTED", "start_review", ["SUBMITTER", "REVIEWER"])).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
  });

  it("lets only organisers decide, and only once reviewing has begun", () => {
    for (const event of ["accept", "reject"] as WorkflowEvent[]) {
      for (const from of ALL) {
        const decision = decideTransition(from, event, ["ORGANISER"]);
        expect(decision.ok).toBe(from === "UNDER_REVIEW" || from === "REVIEWS_COMPLETE");
      }
      expect(decideTransition("REVIEWS_COMPLETE", event, ["SUBMITTER", "REVIEWER"]).ok).toBe(false);
      expect(decideTransition("REVIEWS_COMPLETE", event, ["SYSTEM"]).ok).toBe(false);
    }
  });

  it("lets a submitter withdraw only before reviewers have the paper", () => {
    expect(decideTransition("DRAFT", "withdraw", ["SUBMITTER"]).ok).toBe(true);
    expect(decideTransition("SUBMITTED", "withdraw", ["SUBMITTER"]).ok).toBe(true);
    expect(decideTransition("UNDER_REVIEW", "withdraw", ["SUBMITTER"]).ok).toBe(false);
    // An organiser can, and acts as the organiser even on their own paper.
    expect(decideTransition("UNDER_REVIEW", "withdraw", ["SUBMITTER", "ORGANISER"])).toEqual({
      ok: true,
      to: "WITHDRAWN",
      as: "ORGANISER",
    });
  });

  it("never leaves a decided or withdrawn paper", () => {
    const capacities: Capacity[] = ["SUBMITTER", "ORGANISER", "REVIEWER", "SYSTEM"];
    for (const from of ["ACCEPTED", "REJECTED", "WITHDRAWN"] as SubmissionStatus[]) {
      for (const event of Object.keys(TRANSITIONS) as WorkflowEvent[]) {
        expect(decideTransition(from, event, capacities).ok).toBe(false);
      }
    }
  });

  it("completes reviews when the last reviewer submits, and reopens them for an extra one", () => {
    expect(decideTransition("UNDER_REVIEW", "complete_reviews", ["REVIEWER"])).toMatchObject({
      ok: true,
      to: "REVIEWS_COMPLETE",
    });
    expect(decideTransition("REVIEWS_COMPLETE", "reopen_reviews", ["ORGANISER"])).toMatchObject({
      ok: true,
      to: "UNDER_REVIEW",
    });
  });
});
