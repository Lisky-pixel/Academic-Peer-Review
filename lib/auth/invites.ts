import { consumeToken, findValidToken, issueToken } from "@/lib/auth/account-tokens";
import { logAuthEvent } from "@/lib/auth/audit";
import { hashPassword } from "@/lib/auth/password";
import { normaliseEmail } from "@/lib/auth/schemas";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * Invitations — the only way an organiser or administrator account comes to
 * exist, and one of two ways for a reviewer (the other is signing up).
 *
 * An invite is a User row in status INVITED with no password, plus a
 * single-use token emailed to them. Redeeming the token sets the password and
 * activates the account. Until then the account cannot log in or be assigned
 * work.
 */

export const INVITE_TTL_HOURS = 72;

export type InvitableRole = "REVIEWER" | "ORGANISER" | "ADMIN";

const ROLE_PHRASE: Record<InvitableRole, string> = {
  REVIEWER: "a reviewer",
  ORGANISER: "a conference organiser",
  ADMIN: "an administrator",
};

export type CreateInviteResult =
  { ok: true; userId: string; token: string } | { ok: false; reason: "email_taken" };

/**
 * Creates (or re-sends) an invitation. The caller must already have checked
 * that `invitedBy` may invite this role: administrators may invite anyone,
 * organisers only reviewers. This function trusts its caller.
 *
 * Inviting an address that is still INVITED issues a fresh link and kills the
 * old one, which is how an admin re-sends an invite that expired.
 */
export async function createInvite(input: {
  email: string;
  name: string;
  role: InvitableRole;
  invitedBy: SessionUser;
}): Promise<CreateInviteResult> {
  const email = normaliseEmail(input.email);
  const name = input.name.trim();

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });
  if (existing && existing.status !== "INVITED" && existing.status !== "UNVERIFIED") {
    return { ok: false, reason: "email_taken" };
  }

  let user: { id: string };
  if (existing?.status === "UNVERIFIED") {
    // A half-finished self-registration must not block an admin from inviting
    // that person. It owns nothing yet, so it is converted in place: the
    // password they typed and their confirmation link are both discarded.
    [, user] = await db.$transaction([
      db.token.deleteMany({ where: { userId: existing.id } }),
      db.user.update({
        where: { id: existing.id },
        data: { name, role: input.role, status: "INVITED", passwordHash: null },
        select: { id: true },
      }),
    ]);
  } else {
    user =
      existing ??
      (await db.user.create({
        data: { email, name, role: input.role, status: "INVITED" },
        select: { id: true },
      }));
  }

  const token = await issueToken(user.id, "INVITE", INVITE_TTL_HOURS);
  const link = `${env.APP_URL}/invite/${token}`;
  const roleLabel = ROLE_PHRASE[input.role];

  await sendEmail({
    to: email,
    subject: `You have been invited to ${env.APP_NAME}`,
    text: [
      `Hello ${name},`,
      "",
      `You have been invited to join ${env.APP_NAME} as ${roleLabel}. Choose a password to activate your account:`,
      "",
      link,
      "",
      `The link works once and expires in ${INVITE_TTL_HOURS} hours.`,
    ].join("\n"),
  });

  await logAuthEvent(
    "auth.invite_sent",
    { id: user.id, role: input.role },
    { actor: input.invitedBy },
  );

  return { ok: true, userId: user.id, token };
}

/** The invitee behind a link, or null if the link is no longer usable. */
export function findInvitee(token: string) {
  return findValidToken(token, "INVITE", "INVITED");
}

/**
 * Activates an invited account with the password its owner chose. Returns
 * null if the link is unknown, expired, or already used.
 */
export async function redeemInvite(token: string, password: string): Promise<SessionUser | null> {
  if (!(await findInvitee(token))) return null;

  const passwordHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, "INVITE", "INVITED");
    if (!userId) return null;

    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, status: "ACTIVE" },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    await tx.activityLog.create({
      data: {
        action: "auth.invite_accepted",
        entityType: "User",
        entityId: user.id,
        actorId: user.id,
        actorRole: user.role,
      },
    });
    return user;
  });
}

/**
 * Sends a fresh link for an invitation that is still pending. Returns false
 * if there is no such invitation — it was accepted or cancelled meanwhile.
 */
export async function resendInvite(userId: string, invitedBy: SessionUser): Promise<boolean> {
  const invitee = await db.user.findFirst({
    where: { id: userId, status: "INVITED" },
    select: { email: true, name: true, role: true },
  });
  if (!invitee || invitee.role === "USER") return false;
  // An organiser can only re-send what they could have sent.
  if (invitedBy.role !== "ADMIN" && invitee.role !== "REVIEWER") return false;

  const result = await createInvite({
    email: invitee.email,
    name: invitee.name,
    role: invitee.role,
    invitedBy,
  });
  return result.ok;
}

/**
 * Withdraws a pending invitation. Returns false if it was already accepted.
 *
 * This is one of the few places a row is deleted rather than kept. An account
 * that was never activated has done nothing and owns nothing, and leaving it
 * behind would keep the address permanently reserved. The activity log still
 * records that the invitation was sent and withdrawn, and by whom.
 */
export async function cancelInvite(userId: string, cancelledBy: SessionUser): Promise<boolean> {
  // The status is part of the WHERE, so an invitation accepted a moment ago
  // can never be deleted by a stale page.
  const { count } = await db.user.deleteMany({ where: { id: userId, status: "INVITED" } });
  if (count !== 1) return false;

  await logAuthEvent(
    "auth.invite_cancelled",
    { id: userId, role: cancelledBy.role },
    { actor: cancelledBy },
  );
  return true;
}

/** Every invitation not yet accepted, newest first, with its current link. */
export function findPendingInvites() {
  return db.user.findMany({
    where: { status: "INVITED" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      tokens: {
        where: { purpose: "INVITE", consumedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { expiresAt: true },
      },
    },
  });
}

export type PendingInviteRecord = Awaited<ReturnType<typeof findPendingInvites>>[number];
