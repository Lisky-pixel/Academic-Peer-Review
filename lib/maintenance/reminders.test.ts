// @vitest-environment node
import { describe, expect, it } from "vitest";
import { remindersDue } from "./index";

const DAY = 86_400_000;
const now = new Date("2026-10-01T12:00:00Z");
const dueIn = (days: number) => new Date(now.getTime() + days * DAY);

describe("remindersDue", () => {
  it("is none more than a week out", () => {
    expect(remindersDue(dueIn(10), now)).toBe(0);
  });

  it("is one within seven days, two within three, three within one", () => {
    expect(remindersDue(dueIn(7), now)).toBe(1);
    expect(remindersDue(dueIn(4), now)).toBe(1);
    expect(remindersDue(dueIn(3), now)).toBe(2);
    expect(remindersDue(dueIn(1), now)).toBe(3);
    expect(remindersDue(dueIn(0.2), now)).toBe(3);
  });

  it("is none once the review is overdue — that goes to the organisers instead", () => {
    expect(remindersDue(dueIn(-1), now)).toBe(0);
  });
});
