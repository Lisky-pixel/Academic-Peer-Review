"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { createInvite } from "@/lib/auth/invites";
import { type FormState, inviteSchema, zodFieldErrors } from "@/lib/auth/schemas";
import {
  addOrganiser,
  createConference,
  recordPayment,
  removeOrganiser,
  updateConference,
} from "@/lib/conferences";
import { conferenceSchema, paymentSchema } from "@/lib/conferences/schema";
import { isUuid } from "@/lib/format";

/** Server actions for administrators: conferences, their organisers, and payments. */

const FIELDS = [
  "name",
  "description",
  "venue",
  "startsOn",
  "endsOn",
  "submissionsOpenAt",
  "submissionsCloseAt",
  "reviewDeadline",
  "reviewersPerPaper",
  "maxPapersPerReviewer",
  "doubleBlind",
  "submissionFormat",
  "topics",
  "packageName",
  "submissionLimit",
] as const;

function valuesFrom(formData: FormData): Record<string, string> {
  return Object.fromEntries(FIELDS.map((name) => [name, String(formData.get(name) ?? "")]));
}

export async function saveConferenceAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const conferenceId = String(formData.get("conferenceId") ?? "");

  const values = valuesFrom(formData);
  const parsed = conferenceSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  if (conferenceId) {
    if (!isUuid(conferenceId) || !(await updateConference(admin, conferenceId, parsed.data))) {
      return { error: "This conference could not be found.", values };
    }
    revalidatePath(`/admin/conferences/${conferenceId}`);
    revalidatePath("/admin");
    return { success: true, values };
  }

  const created = await createConference(admin, parsed.data);
  revalidatePath("/admin");
  redirect(`/admin/conferences/${created.id}?created=1`);
}

export async function addOrganiserAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!isUuid(conferenceId) || !isUuid(userId)) return { error: "Choose an organiser." };

  const result = await addOrganiser(admin, conferenceId, userId);
  if (!result.ok) {
    return {
      error:
        result.reason === "already_added"
          ? "They already organise this conference."
          : "That account is not an organiser.",
    };
  }
  revalidatePath(`/admin/conferences/${conferenceId}`);
  return { success: true };
}

/** Invites a new organiser by email and attaches them to the conference at once. */
export async function inviteOrganiserAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: "ORGANISER",
  };
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };
  if (!isUuid(conferenceId)) return { error: "This conference could not be found.", values };

  const invite = await createInvite({ ...parsed.data, role: "ORGANISER", invitedBy: admin });
  if (!invite.ok) {
    return {
      values,
      error:
        "That email already has an account. If they are an organiser, choose them from the list instead.",
    };
  }
  await addOrganiser(admin, conferenceId, invite.userId);
  revalidatePath(`/admin/conferences/${conferenceId}`);
  return { success: true, values: { email: parsed.data.email } };
}

export async function removeOrganiserAction(formData: FormData): Promise<void> {
  const admin = await requireRole("ADMIN");
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!isUuid(conferenceId) || !isUuid(userId)) return;
  await removeOrganiser(admin, conferenceId, userId);
  revalidatePath(`/admin/conferences/${conferenceId}`);
}

export async function recordPaymentAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const values = {
    amount: String(formData.get("amount") ?? ""),
    currency: String(formData.get("currency") ?? ""),
    description: String(formData.get("description") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    paidAt: String(formData.get("paidAt") ?? ""),
  };
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };
  if (!isUuid(conferenceId)) return { error: "This conference could not be found.", values };

  const result = await recordPayment(admin, conferenceId, parsed.data);
  if (!result.ok) return { error: "This conference could not be found.", values };

  revalidatePath(`/admin/conferences/${conferenceId}`);
  return { success: true, values: { receipt: result.receiptNumber } };
}
