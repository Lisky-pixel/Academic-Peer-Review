import { describe, expect, it } from "vitest";
import {
  type Candidate,
  dueDateFor,
  eligibleReviewers,
  needsTiebreaker,
  normaliseInstitution,
  pickReviewers,
  sharesInstitution,
} from "./select";

const HEALTH = "discipline-health";
const LAW = "discipline-law";

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return { id, institution: `Uni ${id}`, disciplineIds: [HEALTH], load: 0, ...overrides };
}

const base = {
  disciplineId: HEALTH as string | null,
  excludedInstitutions: ["University of Lagos"],
  excludedIds: ["author"],
  maxLoad: 3,
};

describe("institutions", () => {
  it("treats differently typed names of one place as the same", () => {
    expect(normaliseInstitution("  University of LAGOS. ")).toBe("university of lagos");
    expect(normaliseInstitution("Université Cheikh Anta Diop")).toBe("universite cheikh anta diop");
    expect(normaliseInstitution("Arts & Sciences")).toBe("arts and sciences");
    expect(normaliseInstitution("")).toBeNull();
    expect(sharesInstitution("university of lagos", ["University of Lagos"])).toBe(true);
    // Somebody with no institution never conflicts.
    expect(sharesInstitution(null, ["University of Lagos"])).toBe(false);
  });
});

describe("who may review a paper", () => {
  it("never the submitter, nor anyone already asked", () => {
    const result = eligibleReviewers({
      ...base,
      candidates: [candidate("author"), candidate("declined"), candidate("free")],
      excludedIds: ["author", "declined"],
    });
    expect(result.map((c) => c.id)).toEqual(["free"]);
  });

  it("never someone from the paper's or the submitter's institution", () => {
    const result = eligibleReviewers({
      ...base,
      candidates: [
        candidate("same", { institution: "university of lagos" }),
        candidate("theirs", { institution: "Makerere University" }),
        candidate("other"),
      ],
      excludedInstitutions: ["University of Lagos", "Makerere University"],
    });
    expect(result.map((c) => c.id)).toEqual(["other"]);
  });

  it("never someone whose workload in the conference is full", () => {
    const result = eligibleReviewers({
      ...base,
      candidates: [candidate("full", { load: 3 }), candidate("room", { load: 2 })],
    });
    expect(result.map((c) => c.id)).toEqual(["room"]);
  });

  it("only reviewers in the paper's discipline — or anyone when it is Other", () => {
    const candidates = [candidate("health"), candidate("law", { disciplineIds: [LAW] })];
    expect(eligibleReviewers({ ...base, candidates }).map((c) => c.id)).toEqual(["health"]);
    expect(eligibleReviewers({ ...base, candidates, disciplineId: null }).map((c) => c.id)).toEqual(
      ["health", "law"],
    );
  });
});

describe("picking reviewers", () => {
  it("chooses the least busy first", () => {
    const picked = pickReviewers(
      [
        candidate("busy", { load: 2 }),
        candidate("idle", { load: 0 }),
        candidate("some", { load: 1 }),
      ],
      2,
    );
    expect(picked).toEqual(["idle", "some"]);
  });

  it("breaks ties at random, and never picks more than asked or available", () => {
    const pool = [candidate("a"), candidate("b"), candidate("c")];
    const reverse = [0.9, 0.5, 0.1];
    let i = 0;
    expect(pickReviewers(pool, 2, () => reverse[i++]!)).toEqual(["c", "b"]);
    expect(pickReviewers(pool, 10)).toHaveLength(3);
    expect(pickReviewers(pool, 0)).toEqual([]);
  });
});

describe("tie-breakers", () => {
  it("are needed when reviewers split on the recommendation", () => {
    expect(
      needsTiebreaker([
        { score: 4, recommend: true },
        { score: 4, recommend: false },
      ]),
    ).toBe(true);
  });

  it("are needed when scores are two or more apart", () => {
    expect(
      needsTiebreaker([
        { score: 5, recommend: true },
        { score: 3, recommend: true },
      ]),
    ).toBe(true);
    expect(
      needsTiebreaker([
        { score: 5, recommend: true },
        { score: 4, recommend: true },
      ]),
    ).toBe(false);
  });

  it("are never needed for a single review", () => {
    expect(needsTiebreaker([{ score: 1, recommend: false }])).toBe(false);
  });
});

describe("due dates", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  it("use the conference deadline when there is time", () => {
    const deadline = new Date("2026-11-01T23:59:59Z");
    expect(dueDateFor(deadline, now)).toBe(deadline);
  });

  it("give a late reviewer at least a week", () => {
    const deadline = new Date("2026-10-03T23:59:59Z");
    expect(dueDateFor(deadline, now).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
});
