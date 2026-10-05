import nodemailer from "nodemailer";
import { env } from "@/lib/env";

/**
 * Outbound email.
 *
 * Callers use `sendEmail` and never learn which provider is behind it: Mailpit
 * over SMTP in development, Resend in production. This is the minimal transport
 * the auth flows need; templates, EmailLog persistence and retry arrive with
 * the notification phase and slot in behind the same function.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class SmtpProvider implements EmailProvider {
  private transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 1025,
    secure: env.SMTP_SECURE,
  });

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO || undefined,
      ...message,
    });
  }
}

class ResendProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
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
  }
}

let provider: EmailProvider | undefined;

export function sendEmail(message: EmailMessage): Promise<void> {
  provider ??= env.EMAIL_PROVIDER === "resend" ? new ResendProvider() : new SmtpProvider();
  return provider.send(message);
}
