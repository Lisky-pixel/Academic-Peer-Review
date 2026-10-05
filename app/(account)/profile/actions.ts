"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/guards";
import { LOGIN_PATH } from "@/lib/auth/routes";
import {
  changePasswordSchema,
  type FormState,
  profileSchema,
  zodFieldErrors,
} from "@/lib/auth/schemas";
import { changePassword, removeAvatar, setAvatar, updateProfile } from "@/lib/profile";
import { AVATAR_MAX_BYTES } from "@/lib/profile/avatar";

/** Every action here acts on the signed-in account and no other. */
async function requireSession() {
  const session = await getCurrentSession();
  if (!session) redirect(LOGIN_PATH);
  return session;
}

/** The header shows the name and picture on every signed-in page. */
function refresh() {
  revalidatePath("/", "layout");
}

export async function updateProfileAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user } = await requireSession();

  const values = {
    name: String(formData.get("name") ?? ""),
    bio: String(formData.get("bio") ?? ""),
  };
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  await updateProfile(user.id, parsed.data);
  refresh();
  return { success: true, values };
}

export async function uploadAvatarAction(formData: FormData): Promise<{ error?: string }> {
  const { user } = await requireSession();

  const file = formData.get("avatar");
  if (!(file instanceof File)) return { error: "Choose a picture to upload." };
  // Checked before reading the body into memory.
  if (file.size > AVATAR_MAX_BYTES) return { error: "That picture is too large." };

  const result = await setAvatar(user.id, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) {
    return {
      error:
        result.reason === "too_large"
          ? "That picture is too large."
          : "That file is not a picture we can use. Try a JPEG or PNG.",
    };
  }

  refresh();
  return {};
}

export async function removeAvatarAction(): Promise<void> {
  const { user } = await requireSession();
  await removeAvatar(user.id);
  refresh();
}

export async function changePasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user, sessionId } = await requireSession();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };

  const result = await changePassword(
    user.id,
    parsed.data.currentPassword,
    parsed.data.password,
    sessionId,
  );

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
      return {
        error: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }
    return { fieldErrors: { currentPassword: ["That is not your current password."] } };
  }

  return { success: true };
}
