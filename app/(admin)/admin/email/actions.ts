"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { explainEmailError, sendTestEmail } from "@/lib/admin/email-log";
import { requireRole } from "@/lib/auth/guards";
import type { FormState } from "@/lib/auth/schemas";

const toSchema = z.string().trim().toLowerCase().pipe(z.email("Enter an email address."));

export async function sendTestEmailAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole("ADMIN");
  const to = String(formData.get("to") ?? "");
  const parsed = toSchema.safeParse(to);
  if (!parsed.success) return { fieldErrors: { to: ["Enter an email address."] }, values: { to } };

  const result = await sendTestEmail(parsed.data);
  revalidatePath("/admin/email");
  if (result.ok) {
    return { success: true, values: { to: parsed.data } };
  }
  const advice = explainEmailError(result.error);
  return {
    values: { to: parsed.data },
    error: advice ? `${advice} (Resend said: ${result.error})` : `It failed: ${result.error}`,
  };
}
