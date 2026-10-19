import { db } from "@/lib/db";
import { deliver } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * The email log, for administrators: what was sent, what failed and why, and a
 * way to send a test message that shows the provider's answer directly.
 *
 * Account emails (verification, reset, invitation) are sent in the background
 * after the page has answered, so when one fails nobody sees an error on
 * screen. This is where that failure becomes visible.
 */

export async function findRecentEmails(limit = 100) {
  const rows = await db.emailLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      toEmail: true,
      subject: true,
      template: true,
      status: true,
      error: true,
      attempts: true,
      createdAt: true,
      sentAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  }));
}

export async function emailCounts(since: Date) {
  const grouped = await db.emailLog.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const count = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0;
  return { sent: count("SENT"), failed: count("FAILED"), queued: count("QUEUED") };
}

/** How email is configured, without revealing the key itself. */
export function emailSettings() {
  return {
    provider: env.EMAIL_PROVIDER,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO || null,
    keySet: Boolean(env.RESEND_API_KEY),
    appUrl: env.APP_URL,
  };
}

/** Sends a test message now and returns exactly what the provider said. */
export async function sendTestEmail(
  to: string,
): Promise<{ ok: true; providerId: string | null } | { ok: false; error: string }> {
  const subject = `Test email from ${env.APP_NAME}`;
  try {
    const providerId = await deliver({
      to,
      subject,
      text: `This is a test email from ${env.APP_NAME} at ${env.APP_URL}.\n\nIf you can read this, email is working.`,
    });
    await db.emailLog.create({
      data: {
        toEmail: to,
        template: "test",
        subject,
        status: "SENT",
        attempts: 1,
        providerId: providerId ?? null,
        sentAt: new Date(),
      },
    });
    return { ok: true, providerId: providerId ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.emailLog.create({
      data: {
        toEmail: to,
        template: "test",
        subject,
        status: "FAILED",
        attempts: 1,
        error: message.slice(0, 500),
      },
    });
    return { ok: false, error: message };
  }
}

/**
 * Plain-language advice for the errors Resend gives most often. The raw
 * error is always shown as well.
 */
export function explainEmailError(error: string): string | null {
  const text = error.toLowerCase();
  if (text.includes("only send testing emails") || text.includes("resend.dev")) {
    return "Resend is still in testing mode: it only delivers to the address you signed up to Resend with. Verify your own domain in Resend and set EMAIL_FROM to an address on it.";
  }
  if (text.includes("not verified") || text.includes("domain")) {
    return "The domain in EMAIL_FROM is not verified in Resend. Check Resend → Domains shows Verified, and that EMAIL_FROM uses exactly that domain (for example noreply@mail.yourdomain.com).";
  }
  if (text.includes("401") || text.includes("api key") || text.includes("unauthorized")) {
    return "Resend rejected the API key. Create a new key with sending access, put it in RESEND_API_KEY on Vercel, and redeploy.";
  }
  if (text.includes("422") || text.includes("invalid `from`") || text.includes("from")) {
    return "EMAIL_FROM is not in a form Resend accepts. Use: Academic Peer Review <noreply@mail.yourdomain.com>, with no extra quotes in the Vercel setting.";
  }
  if (text.includes("429") || text.includes("rate")) {
    return "Resend is rate limiting the account. Wait a minute and try again; the free plan has a daily limit too.";
  }
  if (text.includes("econnrefused") || text.includes("smtp")) {
    return 'The app is trying to use SMTP. On Vercel, EMAIL_PROVIDER must be "resend".';
  }
  return null;
}
