"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { cancelInvite, createInvite, resendInvite } from "@/lib/auth/invites";
import { type FormState, inviteSchema } from "@/lib/auth/schemas";

const PATH = "/admin/invites";

export async function sendInviteAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");

  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? ""),
  };
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
    }
    return { fieldErrors, values };
  }

  const result = await createInvite({ ...parsed.data, invitedBy: admin });
  if (!result.ok) {
    // Said plainly, unlike on the public forms: an admin is entitled to know
    // who has an account.
    return { values, error: "That email address already belongs to an account." };
  }

  revalidatePath(PATH);
  return { success: true, values: { email: parsed.data.email } };
}

export async function resendInviteAction(formData: FormData): Promise<void> {
  const admin = await requireRole("ADMIN");
  await resendInvite(String(formData.get("userId") ?? ""), admin);
  revalidatePath(PATH);
}

export async function cancelInviteAction(formData: FormData): Promise<void> {
  const admin = await requireRole("ADMIN");
  await cancelInvite(String(formData.get("userId") ?? ""), admin);
  revalidatePath(PATH);
}
