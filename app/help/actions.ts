"use server";

import { after } from "next/server";
import { getRequestMetadata } from "@/lib/auth/request";
import { type FormState, zodFieldErrors } from "@/lib/auth/schemas";
import { rateLimitKey, rateLimiter } from "@/lib/rate-limit";
import { contactSchema, sendContactMessage } from "@/lib/support";

/** Five messages an hour from one address is plenty for a person, and too few for a spammer. */
const CONTACT_RULE = { limit: 5, windowSeconds: 60 * 60 };

export async function contactAction(_state: FormState, formData: FormData): Promise<FormState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    message: String(formData.get("message") ?? ""),
  };
  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  const { ip } = await getRequestMetadata();
  const limit = await rateLimiter.consume(rateLimitKey("contact:ip", ip), CONTACT_RULE);
  if (!limit.allowed) {
    return { values, error: "You have sent several messages already. Please try again later." };
  }

  const input = parsed.data;
  after(() => sendContactMessage(input));
  return { success: true };
}
