// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/lib/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  validateSessionToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));

// The real redirect() and notFound() work by throwing, which is what stops the
// rest of a page or action from running. The stand-ins must do the same, or a
// guard that forgot to stop would still pass these tests.
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("@/lib/auth/session", () => ({
  validateSessionToken: mocks.validateSessionToken,
}));

// React only memoises `cache` inside a server render. Made explicit here so
// one test's session can never be served to the next.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

import { getCurrentSession, requireOwnership, requireRole, requireUser } from "@/lib/auth/guards";

function userWith(role: Role, id = "user-1"): SessionUser {
  return { id, email: `${id}@example.test`, name: "Test Person", role, status: "ACTIVE" };
}

function signedInAs(user: SessionUser) {
  mocks.cookieGet.mockReturnValue({ value: "raw-token" });
  mocks.validateSessionToken.mockResolvedValue({
    user,
    sessionId: "session-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

beforeEach(() => {
  mocks.cookieGet.mockReset();
  mocks.validateSessionToken.mockReset();
});

describe("getCurrentSession", () => {
  it("is null with no cookie, without touching the database", async () => {
    mocks.cookieGet.mockReturnValue(undefined);

    expect(await getCurrentSession()).toBeNull();
    expect(mocks.validateSessionToken).not.toHaveBeenCalled();
  });

  it("reads the session cookie by its real name", async () => {
    signedInAs(userWith("USER"));

    await getCurrentSession();

    expect(mocks.cookieGet).toHaveBeenCalledWith("apr_session");
    expect(mocks.validateSessionToken).toHaveBeenCalledWith("raw-token");
  });

  it("is null when the cookie no longer maps to a valid session", async () => {
    mocks.cookieGet.mockReturnValue({ value: "expired-or-revoked" });
    mocks.validateSessionToken.mockResolvedValue(null);

    expect(await getCurrentSession()).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the signed-in user", async () => {
    const user = userWith("REVIEWER");
    signedInAs(user);

    expect(await requireUser()).toEqual(user);
  });

  it("redirects to login with no cookie", async () => {
    mocks.cookieGet.mockReturnValue(undefined);

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to login when the session is expired, revoked or suspended", async () => {
    mocks.cookieGet.mockReturnValue({ value: "stale" });
    mocks.validateSessionToken.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("requireRole", () => {
  const AREAS: Array<[Role, string]> = [
    ["USER", "/dashboard"],
    ["REVIEWER", "/reviewer"],
    ["ADMIN", "/admin"],
  ];

  it.each(AREAS)("lets a %s into their own area", async (role) => {
    const user = userWith(role);
    signedInAs(user);

    expect(await requireRole(role)).toEqual(user);
  });

  // The Phase 2 exit criterion: every role is bounced from the other two.
  for (const [role, home] of AREAS) {
    for (const [otherRole] of AREAS.filter(([r]) => r !== role)) {
      it(`bounces a ${role} from a ${otherRole}-only route to ${home}`, async () => {
        signedInAs(userWith(role));

        await expect(requireRole(otherRole)).rejects.toThrow(`REDIRECT:${home}`);
      });
    }
  }

  it("accepts any of several allowed roles", async () => {
    signedInAs(userWith("REVIEWER"));

    await expect(requireRole("ADMIN", "REVIEWER")).resolves.toMatchObject({ role: "REVIEWER" });
  });

  it("gives an admin no implicit pass into other roles' routes", async () => {
    signedInAs(userWith("ADMIN"));

    await expect(requireRole("USER", "REVIEWER")).rejects.toThrow("REDIRECT:/admin");
  });

  it("sends a signed-out visitor to login, not to a role area", async () => {
    mocks.cookieGet.mockReturnValue(undefined);

    await expect(requireRole("ADMIN")).rejects.toThrow("REDIRECT:/login");
  });

  it("lets nobody through when called with no roles", async () => {
    signedInAs(userWith("ADMIN"));

    await expect(requireRole()).rejects.toThrow("REDIRECT:/admin");
  });
});

describe("requireOwnership", () => {
  it("passes for the owner", () => {
    expect(() => requireOwnership(userWith("USER", "a"), "a")).not.toThrow();
  });

  it("answers not-found for someone else's record, so ids cannot be probed", () => {
    expect(() => requireOwnership(userWith("USER", "a"), "b")).toThrow("NOT_FOUND");
  });

  it("has no admin bypass", () => {
    expect(() => requireOwnership(userWith("ADMIN", "a"), "b")).toThrow("NOT_FOUND");
  });

  it.each([null, undefined, ""])("answers not-found when the owner is %j", (ownerId) => {
    expect(() => requireOwnership(userWith("USER", "a"), ownerId)).toThrow("NOT_FOUND");
  });
});
