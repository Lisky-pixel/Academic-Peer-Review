"use server";

import { revalidatePath } from "next/cache";
import { reactivateUser, type SuspendFailure, suspendUser } from "@/lib/admin/users";
import { requireRole } from "@/lib/auth/guards";
import type { FormState } from "@/lib/auth/schemas";
import { isUuid } from "@/lib/format";

const MESSAGE: Record<SuspendFailure, string> = {
  not_found: "That account no longer exists.",
  is_you: "You cannot suspend your own account.",
  last_admin: "This is the only administrator who can sign in. Add another before suspending it.",
  not_active: "Only an active account can be suspended.",
};

export async function suspendUserAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (!isUuid(userId)) return { error: MESSAGE.not_found };

  const result = await suspendUser(admin, userId);
  if (!result.ok) return { error: MESSAGE[result.reason] };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function reactivateUserAction(formData: FormData): Promise<void> {
  const admin = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (!isUuid(userId)) return;

  await reactivateUser(admin, userId);
  revalidatePath("/admin/users");
}
