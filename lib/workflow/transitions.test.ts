import { describe, expect, it } from "vitest";
import type { SubmissionStatus } from "@/lib/generated/prisma/client";
import { authorStage, progressOf } from "@/lib/submissions/stage";
import {
  type ActorRole,
  decideTransition,
  TERMINAL_STATUSES,
  TRANSITIONS,
  type WorkflowEvent,
} from "@/lib/workflow/transitions";

const STATUSES: SubmissionStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "PENDING_ASSIGNMENT",
  "ASSIGNED",
  "ACCEPTED",
  "IN_REVIEW",
  "REVIEW_SUBMITTED",
  "UNDER_ADMIN_REVIEW",
  "REVISION_REQUESTED",
  "APPROVED",
  "DELIVERED",
  "CANCELLED",
];
const ROLES: ActorRole[] = ["USER", "REVIEWER", "ADMIN", "SYSTEM"];
const EVENTS = Object.keys(TRANSITIONS) as WorkflowEvent[];

/**
 * The lifecycle from docs/PLAN.md, written out independently of the table in
 * transitions.ts: every legal (from, event, role) and where it leads. Any
 * combination not listed here must be refused.
 */
const LEGAL: Array<[SubmissionStatus, WorkflowEvent, ActorRole, SubmissionStatus]> = [
  ["DRAFT", "submit", "USER", "PENDING_ASSIGNMENT"],
  ["PENDING_ASSIGNMENT", "assign", "ADMIN", "ASSIGNED"],
  ["ASSIGNED", "accept", "REVIEWER", "ACCEPTED"],
  ["ASSIGNED", "decline", "REVIEWER", "PENDING_ASSIGNMENT"],
  ["ASSIGNED", "reassign", "ADMIN", "ASSIGNED"],
  ["ACCEPTED", "reassign", "ADMIN", "ASSIGNED"],
  ["IN_REVIEW", "reassign", "ADMIN", "ASSIGNED"],
  ["ACCEPTED", "start_review", "REVIEWER", "IN_REVIEW"],
  ["IN_REVIEW", "submit_review", "REVIEWER", "UNDER_ADMIN_REVIEW"],
  ["UNDER_ADMIN_REVIEW", "request_revision", "ADMIN", "REVISION_REQUESTED"],
  ["REVISION_REQUESTED", "resubmit_review", "REVIEWER", "UNDER_ADMIN_REVIEW"],
  ["UNDER_ADMIN_REVIEW", "approve", "ADMIN", "APPROVED"],
  ["APPROVED", "deliver", "SYSTEM", "DELIVERED"],
  // An author may withdraw only before anyone has been asked to read it.
  ["DRAFT", "cancel", "USER", "CANCELLED"],
  ["PENDING_ASSIGNMENT", "cancel", "USER", "CANCELLED"],
  // An admin may cancel anything that has not finished.
  ...(
    [
      "DRAFT",
      "PENDING_ASSIGNMENT",
      "ASSIGNED",
      "ACCEPTED",
      "IN_REVIEW",
      "UNDER_ADMIN_REVIEW",
      "REVISION_REQUESTED",
      "APPROVED",
    ] as SubmissionStatus[]
  ).map(
    (from) =>
      [from, "cancel", "ADMIN", "CANCELLED"] as [
        SubmissionStatus,
        WorkflowEvent,
        ActorRole,
        SubmissionStatus,
      ],
  ),
];

const key = (from: string, event: string, role: string) => `${from}|${event}|${role}`;
const legal = new Map(LEGAL.map(([from, event, role, to]) => [key(from, event, role), to]));

describe("decideTransition", () => {
  it.each(LEGAL)("%s --%s by %s--> %s", (from, event, role, to) => {
    expect(decideTransition(from, event, role)).toEqual({ ok: true, to });
  });

  it("refuses every other combination of status, event and role", () => {
    const wronglyAllowed: string[] = [];
    let checked = 0;

    for (const from of STATUSES) {
      for (const event of EVENTS) {
        for (const role of ROLES) {
          if (legal.has(key(from, event, role))) continue;
          checked++;
          if (decideTransition(from, event, role).ok) wronglyAllowed.push(key(from, event, role));
        }
      }
    }

    expect(wronglyAllowed).toEqual([]);
    // 12 statuses × 12 events × 4 roles, minus the legal moves above.
    expect(checked).toBe(12 * 12 * 4 - LEGAL.length);
  });

  it.each(TERMINAL_STATUSES)("allows nothing at all out of %s", (from) => {
    for (const event of EVENTS) {
      for (const role of ROLES) {
        expect(decideTransition(from, event, role).ok).toBe(false);
      }
    }
  });

  it("distinguishes a move that is illegal from one this role may not make", () => {
    expect(decideTransition("DRAFT", "approve", "ADMIN")).toEqual({
      ok: false,
      reason: "illegal_from_this_status",
    });
    expect(decideTransition("DRAFT", "submit", "ADMIN")).toEqual({
      ok: false,
      reason: "role_not_allowed",
    });
  });

  it("stops an author withdrawing once a reviewer has been asked", () => {
    for (const from of ["ASSIGNED", "ACCEPTED", "IN_REVIEW", "APPROVED"] as const) {
      expect(decideTransition(from, "cancel", "USER")).toEqual({
        ok: false,
        reason: "role_not_allowed",
      });
    }
  });

  it("never lets a reviewer approve, assign or cancel", () => {
    for (const from of STATUSES) {
      for (const event of [
        "approve",
        "assign",
        "reassign",
        "cancel",
        "request_revision",
      ] as const) {
        expect(decideTransition(from, event, "REVIEWER").ok).toBe(false);
      }
    }
  });
});

describe("what the author is shown", () => {
  it("maps every internal status to a stage", () => {
    for (const status of STATUSES) expect(authorStage(status)).toBeTruthy();
  });

  it("never shows a revision bounce as going backwards", () => {
    // UNDER_ADMIN_REVIEW → REVISION_REQUESTED → UNDER_ADMIN_REVIEW is internal.
    expect(authorStage("REVISION_REQUESTED")).toBe(authorStage("UNDER_ADMIN_REVIEW"));
  });

  it("only ever moves forward along the happy path", () => {
    const path: SubmissionStatus[] = [
      "PENDING_ASSIGNMENT",
      "ASSIGNED",
      "ACCEPTED",
      "IN_REVIEW",
      "UNDER_ADMIN_REVIEW",
      "APPROVED",
      "DELIVERED",
    ];
    const progress = path.map((status) => progressOf(authorStage(status)));

    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress[0]).toBe(1);
    expect(progress.at(-1)).toBe(5);
  });

  it("shows no progress for drafts and cancellations", () => {
    expect(progressOf(authorStage("DRAFT"))).toBe(0);
    expect(progressOf(authorStage("CANCELLED"))).toBe(0);
  });
});
