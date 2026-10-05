import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normaliseEmail } from "@/lib/auth/schemas";
import type { SessionUser } from "@/lib/auth/session";
import { generateToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { rateLimitKey, rateLimiter } from "@/lib/rate-limit";

/**
 * Credential checking and its rate limits.
 *
 * Two limits, because they stop different attacks:
 *
 *  - per email + IP: someone guessing one account's password. Keyed on the
 *    pair rather than the email alone, so an attacker cannot lock a victim out
 *    of their own account just by failing on purpose from somewhere else.
 *  - per IP: someone trying one common password against many accounts. Set
 *    high, because a whole campus can sit behind a single address.
 */
const PAIR_RULE = { limit: 5, windowSeconds: 15 * 60 };
const IP_RULE = { limit: 100, windowSeconds: 15 * 60 };

export type AuthenticateResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid_credentials" }
  | { ok: false; reason: "unverified" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * A real argon2 hash of a password nobody knows. Verifying against it when
 * the account does not exist makes that case cost the same as a wrong
 * password, so response time does not reveal which emails are registered.
 */
let dummyHash: Promise<string> | undefined;

export async function authenticate(
  rawEmail: string,
  password: string,
  ip: string,
): Promise<AuthenticateResult> {
  const email = normaliseEmail(rawEmail);
  const pairKey = rateLimitKey("login:pair", email, ip);

  // Counted before the password is checked, not after a failure, so a burst
  // of parallel guesses cannot all slip in under the limit.
  const [byIp, byPair] = await Promise.all([
    rateLimiter.consume(rateLimitKey("login:ip", ip), IP_RULE),
    rateLimiter.consume(pairKey, PAIR_RULE),
  ]);
  if (!byIp.allowed || !byPair.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.max(byIp.retryAfterSeconds, byPair.retryAfterSeconds),
    };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, status: true, passwordHash: true },
  });

  dummyHash ??= hashPassword(generateToken());
  const passwordMatches = await verifyPassword(user?.passwordHash ?? (await dummyHash), password);

  // The one status worth naming: the person has proved they know the password,
  // so this reveals nothing to a stranger, and "invalid password" would leave
  // someone who simply has not clicked their confirmation link stuck.
  if (user?.passwordHash && passwordMatches && user.status === "UNVERIFIED") {
    return { ok: false, reason: "unverified" };
  }

  // A suspended or not-yet-activated account gets the same answer as a wrong
  // password. Telling a correct-password holder "you are suspended" would
  // confirm the password to someone who may have stolen it.
  if (!user || !user.passwordHash || !passwordMatches || user.status !== "ACTIVE") {
    return { ok: false, reason: "invalid_credentials" };
  }

  await rateLimiter.reset(pairKey);

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    },
  };
}
