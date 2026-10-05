import { after } from "next/server";
import { db } from "@/lib/db";
import { deliver } from "@/lib/email";
import { parseEmailContent, renderNotificationEmail } from "@/lib/email/template";
import { env } from "@/lib/env";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * The email outbox.
 *
 * A workflow notification is written to EmailLog as QUEUED inside the same
 * database transaction as the event that caused it, so an email is queued if
 * and only if the event really happened. Sending happens afterwards, here.
 * If the provider is down the row stays, and is tried again — by the next
 * request that queues mail, and by the scheduled maintenance job.
 */

/** After this many failures a message is left as FAILED for a person to look at. */
export const MAX_ATTEMPTS = 5;

/** Minutes to wait before attempt 2, 3, 4 and 5. */
const BACKOFF_MINUTES = [2, 10, 60, 360];

/** How long a message is reserved while it is being sent. */
const LEASE_MS = 2 * 60 * 1000;

function retryDelayMs(attemptsSoFar: number): number {
  const minutes = BACKOFF_MINUTES[Math.min(attemptsSoFar - 1, BACKOFF_MINUTES.length - 1)]!;
  return minutes * 60 * 1000;
}

export type DispatchSummary = { sent: number; failed: number };

/**
 * Sends queued and retryable messages, oldest first.
 *
 * Safe to run from several places at once. Each message is claimed with a
 * conditional UPDATE that also pushes `nextAttemptAt` forward, so two workers
 * can never both send it; the loser's update matches no row and it moves on.
 */
export async function dispatchQueuedEmails(
  limit: number = 25,
  /** Narrows which messages are considered. Tests use it to stay in their lane. */
  scope: Prisma.EmailLogWhereInput = {},
): Promise<DispatchSummary> {
  const now = new Date();
  const candidates = await db.emailLog.findMany({
    where: {
      ...scope,
      status: { in: ["QUEUED", "FAILED"] },
      attempts: { lt: MAX_ATTEMPTS },
      // Account emails are logged without a payload and are never resent.
      NOT: { payload: { equals: Prisma.DbNull } },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, attempts: true, toEmail: true, subject: true, payload: true },
  });

  const summary: DispatchSummary = { sent: 0, failed: 0 };

  for (const candidate of candidates) {
    const content = parseEmailContent(candidate.payload);
    if (!content) continue;

    const claimed = await db.emailLog.updateMany({
      where: {
        id: candidate.id,
        attempts: candidate.attempts,
        status: { in: ["QUEUED", "FAILED"] },
      },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count !== 1) continue;

    try {
      const { html, text } = await renderNotificationEmail(content, {
        appName: env.APP_NAME,
        appUrl: env.APP_URL,
      });
      const providerId = await deliver({
        to: candidate.toEmail,
        subject: candidate.subject,
        html,
        text,
      });
      await db.emailLog.update({
        where: { id: candidate.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerId: providerId ?? null,
          error: null,
          nextAttemptAt: null,
        },
      });
      summary.sent++;
    } catch (error) {
      await db.emailLog.update({
        where: { id: candidate.id },
        data: {
          status: "FAILED",
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          nextAttemptAt: new Date(Date.now() + retryDelayMs(candidate.attempts + 1)),
        },
      });
      summary.failed++;
    }
  }

  return summary;
}

/**
 * Starts sending what has just been queued, without making the caller wait.
 *
 * Inside a request this runs after the response has gone out. In tests it
 * does nothing, so a test decides exactly when mail is sent. Anything this
 * misses is picked up by the maintenance job.
 */
export function kickEmailDispatch(): void {
  if (env.NODE_ENV === "test") return;

  const run = () =>
    dispatchQueuedEmails().catch((error) => {
      console.error("Email dispatch failed", error);
    });

  try {
    after(run);
  } catch {
    // Not inside a request (a script, the scheduler): just start it.
    void run();
  }
}
