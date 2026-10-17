import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Outbound email: the transport.
 *
 * Callers never learn which provider is behind it — Mailpit over SMTP in
 * development, Resend in production. The sender is always the platform's own
 * address (EMAIL_FROM). No email is ever sent "from" a reviewer or an
 * administrator, which is part of how reviewer anonymity is kept.
 *
 * There are two ways mail leaves the application:
 *
 *   - `sendEmail`, here: account emails (password reset, invitation, email
 *     verification). Sent at once, logged without their body, never retried —
 *     they contain a secret link, and the person can simply ask again.
 *   - the outbox in lib/email/outbox.ts: workflow notifications, queued in the
 *     same transaction as the event that caused them, and retried on failure.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

interface EmailProvider {
  /** Sends one message and returns the provider's id for it, if it gives one. */
  send(message: EmailMessage): Promise<string | undefined>;
}

class SmtpProvider implements EmailProvider {
  private transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 1025,
    secure: env.SMTP_SECURE,
  });

  async send(message: EmailMessage): Promise<string | undefined> {
    const info = await this.transport.sendMail({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO || undefined,
      ...message,
    });
    return typeof info.messageId === "string" ? info.messageId : undefined;
  }
}

class ResendProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<string | undefined> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        reply_to: env.EMAIL_REPLY_TO || undefined,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend rejected the message: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return typeof body?.id === "string" ? body.id : undefined;
  }
}

let provider: EmailProvider | undefined;

/**
 * Addresses under ".invalid" are reserved (RFC 2606) and can never receive
 * mail. The demo accounts use them, so a demonstration on the live site
 * never bounces against the sending domain. Development mail goes to Mailpit,
 * which accepts anything, so the tests still see their messages there.
 */
export function isUndeliverable(address: string): boolean {
  return /\.invalid$/i.test(address.trim());
}

/** Hands a message to the provider. Throws if the provider refuses it. */
export function deliver(message: EmailMessage): Promise<string | undefined> {
  if (env.EMAIL_PROVIDER === "resend" && isUndeliverable(message.to)) {
    return Promise.resolve("skipped-reserved-address");
  }
  provider ??= env.EMAIL_PROVIDER === "resend" ? new ResendProvider() : new SmtpProvider();
  return provider.send(message);
}

/**
 * Sends an account email now, and records that it was sent.
 *
 * The log row has the recipient, the kind of email and the outcome — never the
 * body, because the body contains a single-use secret link and the database
 * stores only hashes of those.
 */
export async function sendEmail(
  message: EmailMessage,
  template: string = "account",
): Promise<void> {
  const record = (status: "SENT" | "FAILED", providerId?: string, error?: string) =>
    db.emailLog
      .create({
        data: {
          toEmail: message.to,
          template,
          subject: message.subject,
          status,
          attempts: 1,
          providerId: providerId ?? null,
          error: error?.slice(0, 500) ?? null,
          sentAt: status === "SENT" ? new Date() : null,
        },
      })
      // A failed log write must not turn a sent email into an error.
      .catch((logError) => console.error("Could not write the email log", logError));

  try {
    const providerId = await deliver(message);
    await record("SENT", providerId);
  } catch (error) {
    await record("FAILED", undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
