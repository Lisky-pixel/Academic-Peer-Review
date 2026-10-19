"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import type { FormState } from "@/lib/auth/schemas";
import {
  approveConference,
  declineConference,
  markInvoicePaid,
  savePaymentInstructions,
} from "@/lib/billing";
import { isUuid } from "@/lib/format";

/** Administrator actions for conference requests, invoices and billing settings. */

function refresh(conferenceId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  if (conferenceId) revalidatePath(`/admin/conferences/${conferenceId}`);
}

const paidSchema = z.object({
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was paid.")
    .transform((value) => new Date(`${value}T00:00:00.000Z`)),
  reference: z
    .string()
    .trim()
    .max(100)
    .transform((value) => value || null),
});

export async function markInvoicePaidAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const values = {
    paidAt: String(formData.get("paidAt") ?? ""),
    reference: String(formData.get("reference") ?? ""),
  };
  const parsed = paidSchema.safeParse(values);
  if (!parsed.success || !isUuid(invoiceId)) {
    return { fieldErrors: { paidAt: ["Enter the date it was paid."] }, values };
  }

  const result = await markInvoicePaid(admin, invoiceId, parsed.data);
  if (!result.ok) {
    return {
      values,
      error:
        result.reason === "not_unpaid"
          ? "This invoice is already paid or cancelled."
          : "This invoice could not be found.",
    };
  }
  refresh(conferenceId);
  return { success: true, values: { receipt: result.receiptNumber } };
}

export async function approveConferenceAction(formData: FormData): Promise<void> {
  const admin = await requireRole("ADMIN");
  const conferenceId = String(formData.get("conferenceId") ?? "");
  if (!isUuid(conferenceId)) return;
  await approveConference(admin, conferenceId);
  refresh(conferenceId);
}

export async function declineConferenceAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isUuid(conferenceId)) return { error: "This conference could not be found." };
  if (reason.length < 5) {
    return { fieldErrors: { reason: ["Tell the organiser why, in a sentence."] } };
  }
  const result = await declineConference(admin, conferenceId, reason);
  if (!result.ok) return { error: "This request has already been decided." };
  refresh(conferenceId);
  return { success: true };
}

export async function savePaymentInstructionsAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const instructions = String(formData.get("instructions") ?? "");
  if (instructions.trim().length < 10) {
    return {
      fieldErrors: { instructions: ["Write how organisers should pay you."] },
      values: { instructions },
    };
  }
  await savePaymentInstructions(admin, instructions);
  refresh();
  return { success: true, values: { instructions } };
}
