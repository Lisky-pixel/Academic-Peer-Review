import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing. The only place argon2 parameters are defined.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation for
 * Argon2id: 19 MiB of memory, 2 iterations, 1 degree of parallelism. The memory
 * cost is what makes GPU cracking expensive, so it is the number to raise — not
 * the iteration count — if these are ever tuned upward.
 *
 * The parameters are encoded into the hash string itself, so raising them later
 * does not invalidate existing passwords: old hashes keep verifying with their
 * original settings.
 *
 * The algorithm is left at the library default, which is Argon2id. It is not
 * named explicitly because @node-rs/argon2 exposes `Algorithm` as an ambient
 * const enum, which cannot be referenced under the `isolatedModules` that Next
 * requires. The variant is pinned by assertion instead: password.test.ts checks
 * that emitted hashes start with `$argon2id$`, so a change of default fails the
 * build rather than silently weakening every new password.
 */
const HASH_OPTIONS = {
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed or empty hash, so callers
 * cannot accidentally treat a corrupt record as a successful login by catching
 * too broadly. Users invited but not yet activated have no hash at all.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  plaintext: string,
): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}
