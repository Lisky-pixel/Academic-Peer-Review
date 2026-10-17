import type { Role } from "@/lib/generated/prisma/client";

/**
 * Where each role lives, and the rules for sending people there.
 *
 * Pure — no database, no environment, no Next request APIs — so it can be
 * imported from proxy.ts, which runs in front of the app and should not drag
 * the Prisma client along with it.
 */

export const SESSION_COOKIE_NAME = "apr_session";

export const LOGIN_PATH = "/login";

/** Each role has exactly one area. A role's home is where a bounce lands. */
export const HOME_PATH = {
  USER: "/dashboard",
  REVIEWER: "/reviewer",
  ORGANISER: "/organiser",
  ADMIN: "/admin",
} as const satisfies Record<Role, string>;

/**
 * Resolves a post-login `next` parameter to somewhere safe to redirect.
 *
 * `next` arrives from the URL, so it is attacker-controlled: a login link that
 * forwards to another origin after a genuine sign-in is a phishing gift. Only
 * same-origin absolute paths survive. "//host" and "/\host" are the classic
 * escapes — browsers read both as protocol-relative URLs.
 */
export function safeRedirectPath(next: unknown, fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Backslashes and control characters (tab, newline) are normalised by
  // browsers in ways that can turn a path back into a host.
  if (/[\\\x00-\x1f\x7f]/.test(next)) return fallback;
  return next;
}
