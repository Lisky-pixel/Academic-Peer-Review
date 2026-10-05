// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deleteExpiredRateLimits, rateLimitKey, rateLimiter } from "@/lib/rate-limit";
import { dbAvailable } from "@/lib/test/db";

const SCOPE = `test-${randomUUID()}`;
const key = (name: string) => rateLimitKey(SCOPE, name);

describe("rateLimitKey", () => {
  it("does not contain the email or IP it was built from", () => {
    const built = rateLimitKey("login:pair", "someone@example.com", "203.0.113.9");

    expect(built).toMatch(/^login:pair:[0-9a-f]{64}$/);
    expect(built).not.toContain("someone");
    expect(built).not.toContain("203.0.113.9");
  });

  it("keeps parts separate, so ('ab','c') and ('a','bc') are different keys", () => {
    expect(rateLimitKey("s", "ab", "c")).not.toBe(rateLimitKey("s", "a", "bc"));
  });
});

describe.skipIf(!dbAvailable)("Postgres rate limiter", () => {
  afterAll(async () => {
    await db.rateLimit.deleteMany({ where: { key: { startsWith: `${SCOPE}:` } } });
  });

  it("allows hits up to the limit, then refuses with a retry time", async () => {
    const rule = { limit: 3, windowSeconds: 60 };

    for (let i = 0; i < 3; i++) {
      expect(await rateLimiter.consume(key("basic"), rule)).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }

    const refused = await rateLimiter.consume(key("basic"), rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("counts keys independently", async () => {
    const rule = { limit: 1, windowSeconds: 60 };

    await rateLimiter.consume(key("a"), rule);

    expect((await rateLimiter.consume(key("a"), rule)).allowed).toBe(false);
    expect((await rateLimiter.consume(key("b"), rule)).allowed).toBe(true);
  });

  it("never lets parallel hits exceed the limit", async () => {
    const rule = { limit: 5, windowSeconds: 60 };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimiter.consume(key("burst"), rule)),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
  });

  it("starts a fresh window once the old one has ended", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    await rateLimiter.consume(key("window"), rule);
    expect((await rateLimiter.consume(key("window"), rule)).allowed).toBe(false);

    // Age the window rather than sleeping through it.
    await db.rateLimit.update({
      where: { key: key("window") },
      data: { resetAt: new Date(Date.now() - 1000) },
    });

    expect((await rateLimiter.consume(key("window"), rule)).allowed).toBe(true);
    const row = await db.rateLimit.findUniqueOrThrow({ where: { key: key("window") } });
    expect(row.count).toBe(1);
    expect(row.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("forgets a key on reset", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    await rateLimiter.consume(key("reset"), rule);

    await rateLimiter.reset(key("reset"));

    expect((await rateLimiter.consume(key("reset"), rule)).allowed).toBe(true);
  });

  it("sweeps finished windows and leaves live ones", async () => {
    await rateLimiter.consume(key("stale"), { limit: 1, windowSeconds: 60 });
    await rateLimiter.consume(key("live"), { limit: 1, windowSeconds: 60 });
    await db.rateLimit.update({
      where: { key: key("stale") },
      data: { resetAt: new Date(Date.now() - 1000) },
    });

    expect(await deleteExpiredRateLimits()).toBeGreaterThanOrEqual(1);

    expect(await db.rateLimit.findUnique({ where: { key: key("stale") } })).toBeNull();
    expect(await db.rateLimit.findUnique({ where: { key: key("live") } })).not.toBeNull();
  });
});
