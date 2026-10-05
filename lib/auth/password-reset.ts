import { consumeToken, findValidToken, issueToken } from "@/lib/auth/account-tokens";
import { hashPassword } from "@/lib/auth/password";
import { normaliseEmail } from "@/lib/auth/schemas";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { rateLimitKey, rateLimiter } from "@/lib/rate-limit";

/** Short, because a reset link is a password-equivalent sitting in an inbox. */
export const RESET_TTL_HOURS = 1;

/** Stops the form being used to flood one person's inbox. */
const PER_EMAIL_RULE = { limit: 3, windowSeconds: 60 * 60 };

/**
 * Sends a reset link if — and only if — the address belongs to an active
 * account with a password. Returns nothing either way: the caller must show
 * the same message whatever happened, or the form becomes a way to test which
 * emails are registered.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = normaliseEmail(rawEmail);

  const limit = await rateLimiter.consume(rateLimitKey("reset:email", email), PER_EMAIL_RULE);
  if (!limit.allowed) return;

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, status: true, passwordHash: true },
  });
  // Invited accounts have no password to reset — their way in is the invite.
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) return;

  const token = await issueToken(user.id, "PASSWORD_RESET", RESET_TTL_HOURS);
  const link = `${env.APP_URL}/reset-password/${token}`;

  await sendEmail({
    to: email,
    subject: `Reset your ${env.APP_NAME} password`,
    text: [
      `Hello ${user.name},`,
      "",
      `Someone asked to reset the password for your ${env.APP_NAME} account. If that was you, choose a new one here:`,
      "",
      link,
      "",
      `The link works once and expires in ${RESET_TTL_HOURS} hour. If you did not ask for this, you can ignore this email — your password has not changed.`,
    ].join("\n"),
  });
}

/** Whether a reset link is still usable, for deciding what the page shows. */
export async function isResetTokenValid(token: string): Promise<boolean> {
  return (await findValidToken(token, "PASSWORD_RESET", "ACTIVE")) !== null;
}

/**
 * Sets a new password using a reset token. Returns false if the token is
 * unknown, expired, already used, or belongs to an account that is not active.
 *
 * Every existing session is revoked: a reset is what someone does when they
 * think their password is known to somebody else, and that somebody may
 * already be logged in.
 */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  // Checked before hashing so that junk tokens cannot be used to make the
  // server burn argon2 time. The authoritative check is consumeToken below.
  if (!(await isResetTokenValid(token))) return false;

  const passwordHash = await hashPassword(newPassword);

  return db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, "PASSWORD_RESET", "ACTIVE");
    if (!userId) return false;

    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { id: true, role: true },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.activityLog.create({
      data: {
        action: "auth.password_reset",
        entityType: "User",
        entityId: user.id,
        actorId: user.id,
        actorRole: user.role,
      },
    });
    return true;
  });
}
