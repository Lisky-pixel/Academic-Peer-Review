import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { HOME_PATH, LOGIN_PATH, SESSION_COOKIE_NAME } from "@/lib/auth/routes";
import { type SessionContext, type SessionUser, validateSessionToken } from "@/lib/auth/session";
import type { Role } from "@/lib/generated/prisma/client";

/**
 * Access guards. Every page, route handler and server action that is not
 * public starts with one of these.
 *
 * proxy.ts also redirects visitors with no session cookie, but that check is
 * only a courtesy: it cannot see whether the cookie is valid or what role it
 * belongs to. These guards are the enforcement — they hit the database, so a
 * revoked session or a suspended account is refused on its very next request.
 */

/**
 * The session for the current request, or null. Wrapped in React's `cache` so
 * a layout, its page and several components can all ask without each paying
 * for a database round trip.
 */
export const getCurrentSession = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

/** Returns the signed-in user, or redirects to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) redirect(LOGIN_PATH);
  return session.user;
}

/**
 * Returns the signed-in user if they hold one of `roles`. Anyone else is sent
 * to their own area rather than shown an error: a reviewer who follows a link
 * to /admin has nothing to learn there, including that it exists.
 */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(HOME_PATH[user.role]);
  return user;
}

/**
 * Asserts that `user` owns a record, e.g. a submission's `authorId`.
 *
 * Fails as "not found" rather than "forbidden", so probing ids cannot reveal
 * which ones exist. Strict by design — there is no admin bypass here, because
 * admins reach records through admin routes guarded by `requireRole("ADMIN")`.
 */
export function requireOwnership(user: SessionUser, ownerId: string | null | undefined): void {
  if (!ownerId || ownerId !== user.id) notFound();
}
