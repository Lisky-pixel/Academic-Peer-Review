import { generateToken, hashToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { env, isProduction } from "@/lib/env";
import type { Role, UserStatus } from "@/lib/generated/prisma/client";

/**
 * Session management.
 *
 * Sessions are opaque random tokens stored in an httpOnly cookie and recorded
 * in the database as a SHA-256 hash. Two consequences worth stating plainly:
 *
 *  1. A database leak cannot be replayed as a login, because the hash is not
 *     the credential — the raw token is, and it exists only in the browser.
 *  2. Sessions can be revoked server-side, immediately and individually, which
 *     a stateless JWT cannot do. That matters here: an admin suspending a
 *     reviewer must actually cut off their access to documents.
 *
 * Token generation and hashing live in lib/auth/tokens.ts, shared with invite
 * and password-reset links.
 */

export const SESSION_COOKIE_NAME = "reviewflow_session";

const MS_PER_DAY = 86_400_000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
};

export type SessionContext = {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
};

type RequestMetadata = {
  ip?: string | null;
  userAgent?: string | null;
};

function expiryFromNow(): Date {
  return new Date(Date.now() + env.SESSION_TTL_DAYS * MS_PER_DAY);
}

/**
 * Issues a new session. Returns the raw token, which is the only moment it
 * exists outside the user's browser — it is never stored or logged.
 */
export async function createSession(
  userId: string,
  metadata: RequestMetadata = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = expiryFromNow();

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: metadata.ip ?? null,
      userAgent: metadata.userAgent ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolves a raw token to its user, or null.
 *
 * Returns null for a suspended user even when the session row is still valid,
 * so suspension takes effect on the next request rather than whenever the
 * cookie happens to expire.
 *
 * Expiry slides: once a session is past its halfway point, using it extends it.
 * This keeps active users logged in without giving idle sessions an unbounded
 * lifetime, and avoids a database write on every single request.
 */
export async function validateSessionToken(token: string): Promise<SessionContext | null> {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: { id: true, email: true, name: true, role: true, status: true },
      },
    },
  });

  if (!session) return null;

  const now = Date.now();

  if (session.expiresAt.getTime() <= now) {
    // Clean up as we go, so expired rows do not accumulate indefinitely.
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (session.user.status !== "ACTIVE") return null;

  let expiresAt = session.expiresAt;
  const halfLife = (env.SESSION_TTL_DAYS * MS_PER_DAY) / 2;
  if (session.expiresAt.getTime() - now < halfLife) {
    expiresAt = expiryFromNow();
    await db.session.update({
      where: { id: session.id },
      data: { expiresAt, lastUsedAt: new Date() },
    });
  }

  return { user: session.user, sessionId: session.id, expiresAt };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.session.delete({ where: { tokenHash: hashToken(token) } }).catch(() => undefined);
}

/**
 * Revokes every session a user holds. Called on password change and on
 * suspension — if a password was changed because it may have been stolen,
 * leaving the thief's existing session alive would defeat the point.
 */
export async function invalidateAllSessionsForUser(userId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { userId } });
  return count;
}

/** Removes expired rows. Called by the scheduled maintenance job. */
export async function deleteExpiredSessions(): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

/**
 * Cookie attributes.
 *
 * sameSite "lax" blocks the cookie on cross-site POSTs — the shape of most
 * CSRF — while still allowing normal inbound navigation, so email links to a
 * submission land the recipient logged in.
 */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
