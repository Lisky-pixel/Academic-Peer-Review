import { generateToken, hashToken, hoursFromNow } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import type { Prisma, TokenPurpose, UserStatus } from "@/lib/generated/prisma/client";

/**
 * Single-use account tokens: invite links and password-reset links.
 *
 * Both flows have the same three steps — issue, show a form if the link is
 * still good, then consume it — and the consume step is where the security
 * lives, so it is written once here.
 */

/**
 * Replaces any outstanding token of this purpose and returns the new raw
 * token. Replacing rather than adding means only the newest link works, so an
 * older email still sitting in an inbox is dead the moment a new one is sent.
 */
export async function issueToken(
  userId: string,
  purpose: TokenPurpose,
  ttlHours: number,
): Promise<string> {
  const token = generateToken();
  await db.$transaction([
    db.token.deleteMany({ where: { userId, purpose, consumedAt: null } }),
    db.token.create({
      data: { tokenHash: hashToken(token), purpose, userId, expiresAt: hoursFromNow(ttlHours) },
    }),
  ]);
  return token;
}

function validTokenWhere(
  token: string,
  purpose: TokenPurpose,
  userStatus: UserStatus,
): Prisma.TokenWhereInput {
  return {
    tokenHash: hashToken(token),
    purpose,
    consumedAt: null,
    expiresAt: { gt: new Date() },
    user: { status: userStatus },
  };
}

/**
 * Looks a token up without using it, so a page can decide between showing the
 * form and showing "this link has expired". Returns null for anything that
 * would not be accepted.
 */
export async function findValidToken(token: string, purpose: TokenPurpose, userStatus: UserStatus) {
  if (!token) return null;
  const row = await db.token.findFirst({
    where: validTokenWhere(token, purpose, userStatus),
    select: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  return row?.user ?? null;
}

/**
 * Marks a token used and returns the id of the user it belongs to, or null if
 * it was not valid.
 *
 * The validity check and the write are one UPDATE, so two simultaneous
 * submissions of the same link cannot both succeed — the second matches zero
 * rows. Must be called inside the transaction that applies the change the
 * token authorises, so a failure there leaves the link usable.
 */
export async function consumeToken(
  tx: Prisma.TransactionClient,
  token: string,
  purpose: TokenPurpose,
  userStatus: UserStatus,
): Promise<string | null> {
  const { count } = await tx.token.updateMany({
    where: validTokenWhere(token, purpose, userStatus),
    data: { consumedAt: new Date() },
  });
  if (count !== 1) return null;

  const row = await tx.token.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
