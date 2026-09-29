import { describe, expect, it } from "vitest";
import { generateToken, hashToken, hoursFromNow, safeCompareHex } from "@/lib/auth/tokens";

describe("generateToken", () => {
  it("is base64url, so it survives cookies and URLs unescaped", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries 32 bytes of entropy", () => {
    expect(Buffer.from(generateToken(), "base64url")).toHaveLength(32);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateToken));
    expect(tokens.size).toBe(500);
  });
});

describe("hashToken", () => {
  it("produces a 64-character hex digest", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("does not return the token itself — the stored value must not be the credential", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
  });
});

describe("safeCompareHex", () => {
  it("accepts identical digests", () => {
    const digest = hashToken("x");
    expect(safeCompareHex(digest, digest)).toBe(true);
  });

  it("rejects different digests", () => {
    expect(safeCompareHex(hashToken("x"), hashToken("y"))).toBe(false);
  });

  it("rejects mismatched lengths without throwing", () => {
    expect(safeCompareHex(hashToken("x"), "abcd")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(safeCompareHex("", "")).toBe(false);
  });
});

describe("hoursFromNow", () => {
  it("returns a future date the requested distance away", () => {
    const before = Date.now();
    const result = hoursFromNow(48).getTime();
    expect(result).toBeGreaterThanOrEqual(before + 48 * 3_600_000);
    expect(result).toBeLessThan(before + 48 * 3_600_000 + 5_000);
  });
});
