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

/** Messages fetched per round. A run keeps taking rounds until its limit. */
const BATCH = 25;

/** How long a message is reserved while it is being sent. */
const LEASE_MS = 2 * 60 * 1000;

function retryDelayMs(attemptsSoFar: number): number {
  const minutes = BACKOFF_MINUTES[Math.min(attemptsSoFar - 1, BACKOFF_MINUTES.length - 1)]!;
  return minutes * 60 * 1000;
}

export type DispatchSummary = { sent: number; failed: number };

type Candidate = {
  id: string;
  attempts: number;
  toEmail: string;
  subject: string;
  payload: Prisma.JsonValue;
};

/** Claims one message and sends it. Returns null if another worker has it. */
async function sendOne(candidate: Candidate): Promise<"sent" | "failed" | null> {
  const content = parseEmailContent(candidate.payload);
  if (!content) return null;

  // The claim also pushes nextAttemptAt forward, which takes the row out of
  // every other worker's query for the length of the lease.
  const claimed = await db.emailLog.updateMany({
    where: {
      id: candidate.id,
      attempts: candidate.attempts,
      status: { in: ["QUEUED", "FAILED"] },
    },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + LEASE_MS) },
  });
  if (claimed.count !== 1) return null;

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
    return "sent";
  } catch (error) {
    await db.emailLog.update({
      where: { id: candidate.id },
      data: {
        status: "FAILED",
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + retryDelayMs(candidate.attempts + 1)),
      },
    });
    return "failed";
  }
}

/**
 * Sends queued and retryable messages, oldest first, until the queue is
 * empty or `limit` messages have been handled.
 *
 * It works through the queue in rounds rather than taking one fixed slice.
 * One event can queue more mail than a single round holds — a submission
 * notifies every administrator — and a fixed slice left the rest waiting for
 * the next event or the next day's maintenance run.
 *
 * Safe to run from several places at once: each message is claimed with a
 * conditional UPDATE, so two workers can never both send it.
 */
export async function dispatchQueuedEmails(
  limit: number = 200,
  /** Narrows which messages are considered. Tests use it to stay in their lane. */
  scope: Prisma.EmailLogWhereInput = {},
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, failed: 0 };
  // Everything looked at in this run, so a row that cannot be sent (bad
  // content, or held by another worker) is not fetched again and again.
  const seen: string[] = [];

  while (seen.length < limit) {
    const candidates = await db.emailLog.findMany({
      where: {
        ...scope,
        id: { notIn: seen },
        status: { in: ["QUEUED", "FAILED"] },
        attempts: { lt: MAX_ATTEMPTS },
        // Account emails are logged without a payload and are never resent.
        NOT: { payload: { equals: Prisma.DbNull } },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: Math.min(BATCH, limit - seen.length),
      select: { id: true, attempts: true, toEmail: true, subject: true, payload: true },
    });
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      seen.push(candidate.id);
      const outcome = await sendOne(candidate);
      if (outcome === "sent") summary.sent++;
      if (outcome === "failed") summary.failed++;
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
