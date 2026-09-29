import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque security tokens — session cookies, invite links, password resets.
 *
 * All three follow the same rule: generate high-entropy random bytes, hand the
 * raw value to exactly one person, and persist only its SHA-256 hash. A dump of
 * the database therefore contains nothing that can be replayed.
 *
 * SHA-256 is the right choice here and argon2 is not. Argon2's slowness exists
 * to protect low-entropy human passwords from brute force; these tokens are 256
 * bits of CSPRNG output, so there is nothing to brute force, and session lookup
 * happens on every single request.
 *
 * No database imports here — this module is pure, which keeps it testable and
 * usable from any layer.
 */

const TOKEN_BYTES = 32;

/** 32 random bytes, base64url-encoded so it is safe in cookies and URLs. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compares two hex digests in constant time.
 *
 * Not needed when a hash is looked up through a database index, but required
 * anywhere a token is compared in application code, where an early-exit string
 * comparison would leak how many leading characters were correct.
 */
export function safeCompareHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;

  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;

  return timingSafeEqual(bufferA, bufferB);
}

/** Returns a Date the given number of hours from now. */
export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}
