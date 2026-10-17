// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.hoisted(() =>
  vi.fn<(message: { to: string; text: string }) => Promise<void>>(),
);
vi.mock("@/lib/email", () => ({ sendEmail }));

import {
  cancelInvite,
  createInvite,
  findInvitee,
  findPendingInvites,
  redeemInvite,
  resendInvite,
} from "@/lib/auth/invites";
import { authenticate } from "@/lib/auth/login";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isResetTokenValid, requestPasswordReset, resetPassword } from "@/lib/auth/password-reset";
import {
  completeRegistration,
  deleteStaleUnverifiedUsers,
  findPendingRegistration,
  resendVerification,
  startRegistration,
} from "@/lib/auth/registration";
import { toPendingInviteDTO } from "@/lib/dto/invite";
import { createSession, type SessionUser, validateSessionToken } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import type { Role, UserStatus } from "@/lib/generated/prisma/client";
import { cleanUpTestUsers, dbAvailable, testEmail, testIp } from "@/lib/test/db";

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a different long password";

// Hashed once: argon2 is deliberately slow and every test needs an account.
const passwordHash = dbAvailable ? await hashPassword(PASSWORD) : "";

async function createUser(
  overrides: { role?: Role; status?: UserStatus; passwordHash?: string | null } = {},
) {
  return db.user.create({
    data: { email: testEmail(), name: "Test Person", passwordHash, ...overrides },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
}

/** The raw token out of the link in the most recent email. */
function tokenFromLastEmail(): string {
  const text = sendEmail.mock.calls.at(-1)?.[0].text ?? "";
  const token = /\/(?:reset-password|invite|verify-email)\/([A-Za-z0-9_-]+)/.exec(text)?.[1];
  if (!token) throw new Error("No link found in the last email");
  return token;
}

beforeEach(() => {
  sendEmail.mockClear();
});

afterAll(async () => {
  if (dbAvailable) await cleanUpTestUsers();
});

describe.skipIf(!dbAvailable)("authenticate", () => {
  it("accepts the right password, whatever the case of the email", async () => {
    const user = await createUser();

    const result = await authenticate(`  ${user.email.toUpperCase()} `, PASSWORD, testIp());

    expect(result).toEqual({ ok: true, user });
  });

  it("never hands the password hash back to the caller", async () => {
    const user = await createUser();

    const result = await authenticate(user.email, PASSWORD, testIp());

    expect(JSON.stringify(result)).not.toContain("argon2");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const user = await createUser();

    const wrongPassword = await authenticate(user.email, "not the password", testIp());
    const unknownEmail = await authenticate(testEmail("nobody"), PASSWORD, testIp());

    expect(wrongPassword).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it.each<UserStatus>(["SUSPENDED", "INVITED"])(
    "refuses a %s account even with the right password, without saying why",
    async (status) => {
      const user = await createUser({ status });

      expect(await authenticate(user.email, PASSWORD, testIp())).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
    },
  );

  it("locks out after five attempts from one address — even the right password", async () => {
    const user = await createUser();
    const ip = testIp();

    for (let i = 0; i < 5; i++) await authenticate(user.email, "guess", ip);
    const result = await authenticate(user.email, PASSWORD, ip);

    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(
      result.ok === false && result.reason === "rate_limited" && result.retryAfterSeconds,
    ).toBeGreaterThan(0);
  });

  it("does not let an attacker lock the real owner out from another address", async () => {
    const user = await createUser();
    const attackerIp = testIp();
    for (let i = 0; i < 6; i++) await authenticate(user.email, "guess", attackerIp);

    expect(await authenticate(user.email, PASSWORD, testIp())).toMatchObject({ ok: true });
  });

  it("forgets failed attempts after a successful login", async () => {
    const user = await createUser();
    const ip = testIp();

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 3; i++) await authenticate(user.email, "typo", ip);
      expect(await authenticate(user.email, PASSWORD, ip)).toMatchObject({ ok: true });
    }
  });
});

describe.skipIf(!dbAvailable)("registration", () => {
  async function register(email = testEmail("new"), password = PASSWORD) {
    await startRegistration({
      accountType: "submitter",
      institution: "Test University",
      name: "  New Person ",
      email,
      password,
    });
    return email.toLowerCase();
  }

  it("stores an unverified USER and emails a confirmation link — nothing is active yet", async () => {
    const email = await register(testEmail("New.Person"));

    const stored = await db.user.findUniqueOrThrow({ where: { email } });
    expect(stored).toMatchObject({ name: "New Person", role: "USER", status: "UNVERIFIED" });
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(await verifyPassword(stored.passwordHash, PASSWORD)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].to).toBe(email);
    expect(await findPendingRegistration(tokenFromLastEmail())).toMatchObject({ email });
  });

  it("creates a submitter, and a smuggled role is ignored", async () => {
    const input = {
      accountType: "submitter" as const,
      institution: "Test University",
      name: "Sneaky",
      email: testEmail(),
      password: PASSWORD,
      role: "ADMIN",
    };

    await startRegistration(input);

    const stored = await db.user.findUniqueOrThrow({ where: { email: input.email } });
    expect(stored.role).toBe("USER");
  });

  it("activates the account given the link and the password", async () => {
    const email = await register();
    const token = tokenFromLastEmail();

    const result = await completeRegistration(token, PASSWORD);

    expect(result).toMatchObject({ ok: true, user: { email, role: "USER", status: "ACTIVE" } });
    expect(await authenticate(email, PASSWORD, testIp())).toMatchObject({ ok: true });
  });

  it("will not activate on the link alone — the password is required too", async () => {
    // The pre-registration attack: sign up under a victim's address and hope
    // they click "confirm". The link holder does not know the password.
    const email = await register();
    const token = tokenFromLastEmail();

    const result = await completeRegistration(token, "what the inbox owner would guess");

    expect(result).toEqual({ ok: false, reason: "wrong_password" });
    const stored = await db.user.findUniqueOrThrow({ where: { email } });
    expect(stored.status).toBe("UNVERIFIED");
  });

  it("does not use up the link on a wrong password", async () => {
    await register();
    const token = tokenFromLastEmail();
    await completeRegistration(token, "a typo");

    expect(await completeRegistration(token, PASSWORD)).toMatchObject({ ok: true });
  });

  it("cannot be confirmed twice, or after the link expires", async () => {
    await register();
    const used = tokenFromLastEmail();
    await completeRegistration(used, PASSWORD);
    expect(await completeRegistration(used, PASSWORD)).toEqual({
      ok: false,
      reason: "invalid_link",
    });

    const email = await register();
    const expired = tokenFromLastEmail();
    await db.token.updateMany({
      where: { user: { email } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await findPendingRegistration(expired)).toBeNull();
    expect(await completeRegistration(expired, PASSWORD)).toEqual({
      ok: false,
      reason: "invalid_link",
    });
  });

  it("tells an unverified user to confirm, but only once they prove the password", async () => {
    const email = await register();

    expect(await authenticate(email, PASSWORD, testIp())).toEqual({
      ok: false,
      reason: "unverified",
    });
    expect(await authenticate(email, "a guess", testIp())).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("lets someone start over before confirming: new password, old link dead", async () => {
    const email = await register();
    const firstLink = tokenFromLastEmail();

    await register(email, NEW_PASSWORD);
    const secondLink = tokenFromLastEmail();

    expect(await db.user.count({ where: { email } })).toBe(1);
    expect(await findPendingRegistration(firstLink)).toBeNull();
    expect(await completeRegistration(secondLink, PASSWORD)).toMatchObject({ ok: false });
    expect(await completeRegistration(secondLink, NEW_PASSWORD)).toMatchObject({ ok: true });
  });

  it("resends a confirmation link on request, killing the previous one", async () => {
    const email = await register();
    const first = tokenFromLastEmail();

    await resendVerification(email.toUpperCase());

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(await findPendingRegistration(first)).toBeNull();
    expect(await findPendingRegistration(tokenFromLastEmail())).not.toBeNull();
  });

  it("does not touch an existing account, and tells its owner by email instead", async () => {
    const existing = await createUser();

    await expect(
      startRegistration({
        accountType: "submitter",
        institution: "Test University",
        name: "Someone Else",
        email: existing.email.toUpperCase(),
        password: NEW_PASSWORD,
      }),
    ).resolves.toBeUndefined();

    const unchanged = await db.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(unchanged).toMatchObject({ name: "Test Person", status: "ACTIVE" });
    expect(await verifyPassword(unchanged.passwordHash, PASSWORD)).toBe(true);
    expect(await db.token.count({ where: { userId: existing.id } })).toBe(0);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const notice = sendEmail.mock.calls[0]![0];
    expect(notice.to).toBe(existing.email);
    expect(notice.text).toContain("already have one");
    expect(notice.text).not.toContain("/verify-email/");
  });

  it("sends a suspended account nothing and changes nothing", async () => {
    const suspended = await createUser({ status: "SUSPENDED" });

    await startRegistration({
      accountType: "submitter",
      institution: "Test University",
      name: "Back Again",
      email: suspended.email,
      password: PASSWORD,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: suspended.id } });
    expect(unchanged.status).toBe("SUSPENDED");
  });

  it("stops emailing one address after three attempts in an hour", async () => {
    const email = testEmail("flood");

    for (let i = 0; i < 5; i++) await register(email);

    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it("sweeps registrations left unconfirmed for a week, and nothing else", async () => {
    const stale = await createUser({ status: "UNVERIFIED" });
    const fresh = await createUser({ status: "UNVERIFIED" });
    const active = await createUser();
    const old = new Date(Date.now() - 8 * 86_400_000);
    await db.$executeRaw`UPDATE "User" SET "updatedAt" = ${old} WHERE "id" IN (${stale.id}::uuid, ${active.id}::uuid)`;

    expect(await deleteStaleUnverifiedUsers()).toBeGreaterThanOrEqual(1);

    expect(await db.user.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: active.id } })).not.toBeNull();
  });
});

describe.skipIf(!dbAvailable)("invite management", () => {
  async function invite() {
    const admin = await createUser({ role: "ADMIN" });
    const email = testEmail("invitee");
    const result = await createInvite({
      email,
      name: "New Reviewer",
      role: "REVIEWER",
      invitedBy: admin,
    });
    if (!result.ok) throw new Error("invite failed");
    return { ...result, email, admin };
  }

  it("lists pending invitations as DTOs carrying no secrets", async () => {
    const { userId, email } = await invite();

    const records = await findPendingInvites();
    const dto = toPendingInviteDTO(records.find((record) => record.id === userId)!);

    expect(dto).toMatchObject({ id: userId, email, role: "REVIEWER", linkExpired: false });
    expect(Object.keys(dto).sort()).toEqual(
      ["email", "id", "invitedAt", "linkExpired", "linkExpiresAt", "name", "role"].sort(),
    );
  });

  it("marks an invitation whose link has lapsed as expired", async () => {
    const { userId } = await invite();
    await db.token.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const records = await findPendingInvites();
    const dto = toPendingInviteDTO(records.find((record) => record.id === userId)!);

    expect(dto.linkExpired).toBe(true);
  });

  it("drops an invitation from the list once it is accepted", async () => {
    const { userId, token } = await invite();
    await redeemInvite(token, PASSWORD);

    const records = await findPendingInvites();

    expect(records.some((record) => record.id === userId)).toBe(false);
  });

  it("resends with a new link and kills the old one", async () => {
    const { userId, token, admin } = await invite();

    expect(await resendInvite(userId, admin)).toBe(true);

    expect(await findInvitee(token)).toBeNull();
    expect(await findInvitee(tokenFromLastEmail())).not.toBeNull();
  });

  it("cancels an invitation: the link dies, the address is free, and it is logged", async () => {
    const { userId, token, email, admin } = await invite();

    expect(await cancelInvite(userId, admin)).toBe(true);

    expect(await findInvitee(token)).toBeNull();
    expect(await redeemInvite(token, PASSWORD)).toBeNull();
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    const log = await db.activityLog.findFirstOrThrow({
      where: { action: "auth.invite_cancelled", entityId: userId },
    });
    expect(log.actorId).toBe(admin.id);
    await db.activityLog.deleteMany({ where: { entityId: userId } });
  });

  it("cannot cancel or resend for an account that is already active", async () => {
    const { userId, token, admin } = await invite();
    await redeemInvite(token, PASSWORD);
    const bystander = await createUser();

    expect(await cancelInvite(userId, admin)).toBe(false);
    expect(await resendInvite(userId, admin)).toBe(false);
    expect(await cancelInvite(bystander.id, admin)).toBe(false);

    expect(await db.user.findUnique({ where: { id: userId } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: bystander.id } })).not.toBeNull();
  });

  it("converts a half-finished self-registration into the invitation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const email = testEmail("halfway");
    await startRegistration({
      accountType: "submitter",
      institution: "Test University",
      name: "Half Way",
      email,
      password: PASSWORD,
    });
    const verifyLink = tokenFromLastEmail();

    const result = await createInvite({
      email,
      name: "Half Way",
      role: "REVIEWER",
      invitedBy: admin,
    });

    expect(result.ok).toBe(true);
    const stored = await db.user.findUniqueOrThrow({ where: { email } });
    expect(stored).toMatchObject({ role: "REVIEWER", status: "INVITED", passwordHash: null });
    // The self-registration link must not be able to activate a reviewer.
    expect(await completeRegistration(verifyLink, PASSWORD)).toMatchObject({ ok: false });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({
      status: "INVITED",
    });
  });
});

describe.skipIf(!dbAvailable)("password reset", () => {
  it("emails a link that sets a new password and revokes every session", async () => {
    const user = await createUser();
    const session = await createSession(user.id);

    await requestPasswordReset(user.email.toUpperCase());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].to).toBe(user.email);
    const token = tokenFromLastEmail();

    expect(await isResetTokenValid(token)).toBe(true);
    expect(await resetPassword(token, NEW_PASSWORD)).toBe(true);

    expect(await authenticate(user.email, NEW_PASSWORD, testIp())).toMatchObject({ ok: true });
    expect(await authenticate(user.email, PASSWORD, testIp())).toMatchObject({ ok: false });
    expect(await validateSessionToken(session.token)).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);
    const token = tokenFromLastEmail();

    const rows = await db.token.findMany({ where: { userId: user.id } });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(rows[0]!.tokenHash).not.toBe(token);
  });

  it("cannot be used twice", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);
    const token = tokenFromLastEmail();

    expect(await resetPassword(token, NEW_PASSWORD)).toBe(true);

    expect(await isResetTokenValid(token)).toBe(false);
    expect(await resetPassword(token, "yet another password")).toBe(false);
    expect(await authenticate(user.email, NEW_PASSWORD, testIp())).toMatchObject({ ok: true });
  });

  it("lets only one of two simultaneous submissions win", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);
    const token = tokenFromLastEmail();

    const results = await Promise.all([
      resetPassword(token, "first password choice"),
      resetPassword(token, "second password choice"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rejects an expired link", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);
    const token = tokenFromLastEmail();
    await db.token.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await isResetTokenValid(token)).toBe(false);
    expect(await resetPassword(token, NEW_PASSWORD)).toBe(false);
    expect(await authenticate(user.email, PASSWORD, testIp())).toMatchObject({ ok: true });
  });

  it("kills the previous link when a new one is requested", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);
    const first = tokenFromLastEmail();
    await requestPasswordReset(user.email);
    const second = tokenFromLastEmail();

    expect(await isResetTokenValid(first)).toBe(false);
    expect(await isResetTokenValid(second)).toBe(true);
  });

  it("rejects a link once the account is suspended", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);
    const token = tokenFromLastEmail();
    await db.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });

    expect(await resetPassword(token, NEW_PASSWORD)).toBe(false);
  });

  it("rejects a made-up token", async () => {
    expect(await resetPassword("not-a-real-token", NEW_PASSWORD)).toBe(false);
    expect(await resetPassword("", NEW_PASSWORD)).toBe(false);
  });

  it("will not accept an invite token as a reset token", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const invite = await createInvite({
      email: testEmail("invitee"),
      name: "Invitee",
      role: "REVIEWER",
      invitedBy: admin,
    });
    if (!invite.ok) throw new Error("invite failed");

    expect(await resetPassword(invite.token, NEW_PASSWORD)).toBe(false);
    expect(await findInvitee(invite.token)).not.toBeNull();
  });

  it.each([
    ["an unknown address", async () => testEmail("nobody")],
    ["a suspended account", async () => (await createUser({ status: "SUSPENDED" })).email],
    [
      "an invited account with no password yet",
      async () => (await createUser({ status: "INVITED", passwordHash: null })).email,
    ],
  ])("sends nothing, and does not throw, for %s", async (_label, makeEmail) => {
    await expect(requestPasswordReset(await makeEmail())).resolves.toBeUndefined();

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stops emailing one address after three requests in an hour", async () => {
    const user = await createUser();

    for (let i = 0; i < 5; i++) await requestPasswordReset(user.email);

    expect(sendEmail).toHaveBeenCalledTimes(3);
  });
});

describe.skipIf(!dbAvailable)("invites", () => {
  async function invite(role: "REVIEWER" | "ADMIN" = "REVIEWER") {
    const admin: SessionUser = await createUser({ role: "ADMIN" });
    const email = testEmail("invitee");
    const result = await createInvite({ email, name: "New Reviewer", role, invitedBy: admin });
    if (!result.ok) throw new Error("invite failed");
    return { ...result, email, admin };
  }

  it("creates an account that cannot log in until the invite is redeemed", async () => {
    const { userId, email } = await invite();

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ role: "REVIEWER", status: "INVITED", passwordHash: null });
    expect(sendEmail.mock.calls.at(-1)![0].to).toBe(email);
    expect(await authenticate(email, "", testIp())).toMatchObject({ ok: false });
  });

  it("records who sent the invite", async () => {
    const { userId, admin } = await invite();

    const log = await db.activityLog.findFirstOrThrow({
      where: { action: "auth.invite_sent", entityId: userId },
    });
    expect(log).toMatchObject({ actorId: admin.id, actorRole: "ADMIN" });
  });

  it("activates the account with the chosen password and the invited role", async () => {
    const { email } = await invite();
    const token = tokenFromLastEmail();

    expect(await findInvitee(token)).toMatchObject({ email, name: "New Reviewer" });
    const user = await redeemInvite(token, PASSWORD);

    expect(user).toMatchObject({ email, role: "REVIEWER", status: "ACTIVE" });
    expect(await authenticate(email, PASSWORD, testIp())).toMatchObject({ ok: true });
  });

  it("cannot be redeemed twice", async () => {
    const { email, token } = await invite();
    await redeemInvite(token, PASSWORD);

    expect(await findInvitee(token)).toBeNull();
    expect(await redeemInvite(token, NEW_PASSWORD)).toBeNull();
    expect(await authenticate(email, PASSWORD, testIp())).toMatchObject({ ok: true });
  });

  it("rejects an expired invite", async () => {
    const { userId, token } = await invite();
    await db.token.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await findInvitee(token)).toBeNull();
    expect(await redeemInvite(token, PASSWORD)).toBeNull();
  });

  it("re-inviting issues a new link and kills the old one, without a duplicate account", async () => {
    const first = await invite();
    const second = await createInvite({
      email: first.email,
      name: "New Reviewer",
      role: "REVIEWER",
      invitedBy: first.admin,
    });
    if (!second.ok) throw new Error("re-invite failed");

    expect(second.userId).toBe(first.userId);
    expect(await findInvitee(first.token)).toBeNull();
    expect(await findInvitee(second.token)).not.toBeNull();
  });

  it("refuses to invite an address that already has an active account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const existing = await createUser();

    const result = await createInvite({
      email: existing.email.toUpperCase(),
      name: "Existing",
      role: "REVIEWER",
      invitedBy: admin,
    });

    expect(result).toEqual({ ok: false, reason: "email_taken" });
    expect(sendEmail).not.toHaveBeenCalled();
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(unchanged).toMatchObject({ role: "USER", status: "ACTIVE" });
  });

  it("will not accept a reset token as an invite", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);

    expect(await redeemInvite(tokenFromLastEmail(), NEW_PASSWORD)).toBeNull();
  });
});
