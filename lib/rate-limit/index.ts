import { hashToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";

/**
 * Rate limiting.
 *
 * Callers depend on the `RateLimiter` interface, not on Postgres. The database
 * implementation below is the right one at this scale — it adds no fourth
 * vendor and survives serverless cold starts, which an in-memory counter does
 * not — and it can be swapped for Redis by replacing `rateLimiter` alone.
 *
 * Fixed windows, not sliding ones: the worst case is a burst of 2× the limit
 * across a window boundary, which is irrelevant against password guessing and
 * buys a single-statement, race-free implementation.
 */

export type RateLimitRule = {
  /** Hits allowed per window. */
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets. Zero when allowed. */
  retryAfterSeconds: number;
};

export interface RateLimiter {
  /** Records one hit against `key` and reports whether it was within the rule. */
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  /** Forgets a key, e.g. failed-login history after a successful login. */
  reset(key: string): Promise<void>;
}

/**
 * Builds a storage key from a scope and the identifying parts (email, IP).
 * The parts are hashed so the table holds no addresses, including those of
 * people who typed an email that was never registered.
 */
export function rateLimitKey(scope: string, ...parts: string[]): string {
  return `${scope}:${hashToken(parts.join("\n"))}`;
}

class PostgresRateLimiter implements RateLimiter {
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    // One atomic upsert. Concurrent hits on the same key serialise on the row
    // lock, so two simultaneous guesses can never both read "4 of 5".
    const rows = await db.$queryRaw<Array<{ count: number; retryAfter: number }>>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt")
      VALUES (${key}, 1, now() + make_interval(secs => ${rule.windowSeconds}))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1
                       ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt"
                         ELSE "RateLimit"."resetAt" END
      RETURNING "count",
                CEIL(EXTRACT(EPOCH FROM ("resetAt" - now())))::int AS "retryAfter"
    `;

    const row = rows[0];
    if (!row || row.count <= rule.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, row.retryAfter) };
  }

  async reset(key: string): Promise<void> {
    await db.rateLimit.deleteMany({ where: { key } });
  }
}

export const rateLimiter: RateLimiter = new PostgresRateLimiter();

/** Removes finished windows. Called by the scheduled maintenance job. */
export async function deleteExpiredRateLimits(): Promise<number> {
  const { count } = await db.rateLimit.deleteMany({ where: { resetAt: { lte: new Date() } } });
  return count;
}
