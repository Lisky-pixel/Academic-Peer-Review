import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "Correct horse battery staple")).resolves.toBe(false);
  });

  it("produces a different hash each time, so equal passwords are not detectable", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });

  it("emits an argon2id hash carrying its own parameters", async () => {
    const hash = await hashPassword("whatever");
    // e.g. $argon2id$v=19$m=19456,t=2,p=1$<salt>$<digest>
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("returns false for a user who has no password set yet", async () => {
    await expect(verifyPassword(null, "anything")).resolves.toBe(false);
    await expect(verifyPassword(undefined, "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
  });

  it("returns false rather than throwing on a corrupt hash", async () => {
    await expect(verifyPassword("not-a-hash", "anything")).resolves.toBe(false);
  });
});
