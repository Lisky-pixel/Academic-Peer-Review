import { consumeToken, findValidToken, issueToken } from "@/lib/auth/account-tokens";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normaliseEmail } from "@/lib/auth/schemas";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { rateLimitKey, rateLimiter } from "@/lib/rate-limit";

/**
 * Public self-registration, in two steps.
 *
 *  1. `startRegistration` stores the account as UNVERIFIED and emails a link.
 *  2. `completeRegistration` activates it, given that link and the password.
 *
 * The split exists so the form cannot be used to find out who has an account.
 * Step 1 looks identical from outside whether the address is new or taken;
 * what differs is the email that arrives, and only the owner of the inbox
 * sees that.
 *
 * There is deliberately no `role` parameter anywhere in this file. It is the
 * only code path the public can reach that creates an account, and it creates
 * authors. Reviewers and admins exist only through lib/auth/invites.ts.
 */

export const VERIFY_TTL_HOURS = 24;

/** Unverified accounts older than this are removed by the maintenance job. */
const STALE_UNVERIFIED_DAYS = 7;

/** Stops the form being used to flood one person's inbox. */
const PER_EMAIL_RULE = { limit: 3, windowSeconds: 60 * 60 };

async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
  const token = await issueToken(user.id, "EMAIL_VERIFICATION", VERIFY_TTL_HOURS);

  await sendEmail({
    to: user.email,
    subject: `Confirm your email for ${env.APP_NAME}`,
    text: [
      `Hello ${user.name},`,
      "",
      `Confirm this address to finish creating your ${env.APP_NAME} account:`,
      "",
      `${env.APP_URL}/verify-email/${token}`,
      "",
      `The link works once and expires in ${VERIFY_TTL_HOURS} hours. If you did not sign up, ignore this email and no account will be created.`,
    ].join("\n"),
  });
}

/**
 * Begins a registration. Returns nothing, and the caller must show the same
 * "check your inbox" message whatever happened here.
 */
export async function startRegistration(input: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  const email = normaliseEmail(input.email);
  const name = input.name.trim();

  const limit = await rateLimiter.consume(rateLimitKey("register:email", email), PER_EMAIL_RULE);
  if (!limit.allowed) return;

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, status: true },
  });

  if (existing && existing.status !== "UNVERIFIED") {
    // Somebody already owns this address here. Tell them — by email, where
    // only they can read it — rather than telling whoever filled in the form.
    // Suspended accounts get nothing: there is no action for them to take.
    if (existing.status === "ACTIVE") {
      await sendEmail({
        to: email,
        subject: `You already have a ${env.APP_NAME} account`,
        text: [
          `Hello ${existing.name},`,
          "",
          `Someone tried to create a ${env.APP_NAME} account with this email address, but you already have one. If that was you, sign in instead:`,
          "",
          `${env.APP_URL}/login`,
          "",
          `If you have forgotten your password you can reset it at ${env.APP_URL}/forgot-password. If it was not you, there is nothing you need to do.`,
        ].join("\n"),
      });
    } else if (existing.status === "INVITED") {
      await sendEmail({
        to: email,
        subject: `You have a pending ${env.APP_NAME} invitation`,
        text: [
          `Hello ${existing.name},`,
          "",
          `Someone tried to create a ${env.APP_NAME} account with this email address, but it has already been invited. Use the link in your invitation email to activate it, or ask the administrator who invited you to send a new one.`,
        ].join("\n"),
      });
    }
    return;
  }

  const passwordHash = await hashPassword(input.password);

  let user: { id: string; email: string; name: string };
  try {
    // Signing up again before confirming replaces the earlier attempt, so a
    // mistyped password or a lost email is fixed by simply starting over.
    user = existing
      ? await db.user.update({
          where: { id: existing.id },
          data: { name, passwordHash },
          select: { id: true, email: true, name: true },
        })
      : await db.user.create({
          data: { name, email, passwordHash, role: "USER", status: "UNVERIFIED" },
          select: { id: true, email: true, name: true },
        });
  } catch (error) {
    // Two simultaneous signups for one address: the unique index lets one
    // through, and that one sends the email.
    if ((error as { code?: string }).code === "P2002") return;
    throw error;
  }

  await sendVerificationEmail(user);
}

/**
 * Sends a fresh confirmation link to an account that is still unverified.
 * Used when such a user tries to log in. Silent for every other case.
 */
export async function resendVerification(rawEmail: string): Promise<void> {
  const email = normaliseEmail(rawEmail);

  const limit = await rateLimiter.consume(rateLimitKey("register:email", email), PER_EMAIL_RULE);
  if (!limit.allowed) return;

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, status: true },
  });
  if (user?.status === "UNVERIFIED") await sendVerificationEmail(user);
}

/** The pending account behind a link, or null if the link is not usable. */
export function findPendingRegistration(token: string) {
  return findValidToken(token, "EMAIL_VERIFICATION", "UNVERIFIED");
}

export type CompleteRegistrationResult =
  { ok: true; user: SessionUser } | { ok: false; reason: "invalid_link" | "wrong_password" };

/**
 * Activates a pending account.
 *
 * Asks for the password as well as the emailed link, and needs both. The link
 * proves control of the inbox; the password proves this is the person who
 * filled in the form. Without the second check, anyone could register with a
 * password they know under someone else's address and wait for the real owner
 * to click "confirm" on an email they did not expect — handing over an
 * activated account. A wrong password does not use up the link.
 */
export async function completeRegistration(
  token: string,
  password: string,
): Promise<CompleteRegistrationResult> {
  const pending = await findPendingRegistration(token);
  if (!pending) return { ok: false, reason: "invalid_link" };

  const stored = await db.user.findUnique({
    where: { id: pending.id },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(stored?.passwordHash, password))) {
    return { ok: false, reason: "wrong_password" };
  }

  return db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, "EMAIL_VERIFICATION", "UNVERIFIED");
    if (!userId) return { ok: false, reason: "invalid_link" } as const;

    const user = await tx.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    await tx.activityLog.create({
      data: {
        action: "auth.registered",
        entityType: "User",
        entityId: user.id,
        actorId: user.id,
        actorRole: user.role,
      },
    });
    return { ok: true, user } as const;
  });
}

/**
 * Removes registrations that were never confirmed. Safe to delete outright:
 * an unverified account cannot log in, so it owns nothing. Called by the
 * scheduled maintenance job.
 */
export async function deleteStaleUnverifiedUsers(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_UNVERIFIED_DAYS * 86_400_000);
  const { count } = await db.user.deleteMany({
    where: { status: "UNVERIFIED", updatedAt: { lt: cutoff } },
  });
  return count;
}
