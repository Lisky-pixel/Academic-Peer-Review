import { z } from "zod";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * The contact form on the help page. A message is emailed to every active
 * administrator, with the sender's address as the reply-to line in the body,
 * so answering is just replying to them.
 */

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter your email address, so we can reply.").max(254)),
  topic: z.enum(["account", "submitting", "reviewing", "organising", "other"], "Choose a topic."),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more.")
    .max(4000, "Keep your message under 4,000 characters."),
});

export type ContactInput = z.infer<typeof contactSchema>;

const TOPIC_LABEL: Record<ContactInput["topic"], string> = {
  account: "Signing in or my account",
  submitting: "Submitting a paper",
  reviewing: "Reviewing",
  organising: "Running a conference",
  other: "Something else",
};

export async function sendContactMessage(input: ContactInput): Promise<void> {
  const admins = await db.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { email: true },
  });

  for (const admin of admins) {
    await sendEmail(
      {
        to: admin.email,
        subject: `Help request: ${TOPIC_LABEL[input.topic]} — ${input.name}`,
        text: [
          `${input.name} <${input.email}> wrote through the help page of ${env.APP_NAME}:`,
          "",
          `Topic: ${TOPIC_LABEL[input.topic]}`,
          "",
          input.message,
          "",
          `Reply to them at ${input.email}.`,
        ].join("\n"),
      },
      "support",
    ).catch((error) => console.error("A help request could not be emailed", error));
  }
}
