import { cookies, headers } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/routes";
import { createSession, invalidateSession, sessionCookieOptions } from "@/lib/auth/session";

/**
 * The parts of auth that touch the current HTTP request: who is calling, and
 * the session cookie. Only callable from server actions and route handlers —
 * cookies cannot be written while a page is rendering.
 */

export type RequestMetadata = {
  /** "unknown" when no proxy reported one, which only happens in local dev. */
  ip: string;
  userAgent: string | null;
};

export async function getRequestMetadata(): Promise<RequestMetadata> {
  const headerList = await headers();
  // The left-most entry is the client; later entries are the proxies it
  // passed through. Vercel overwrites this header, so it cannot be spoofed
  // there.
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || headerList.get("x-real-ip") || "unknown",
    userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
  };
}

/** Issues a session for the user and sets its cookie. */
export async function signIn(userId: string, metadata: RequestMetadata): Promise<void> {
  const { token } = await createSession(userId, metadata);
  (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

/** Revokes the current session server-side, then drops the cookie. */
export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) await invalidateSession(token);
  cookieStore.delete(SESSION_COOKIE_NAME);
}
