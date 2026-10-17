"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/guards";
import { LOGIN_PATH } from "@/lib/auth/routes";
import {
  changePasswordSchema,
  type FormState,
  profileSchema,
  reviewerProfileSchema,
  zodFieldErrors,
} from "@/lib/auth/schemas";
import { REJECTION_MESSAGE } from "@/lib/files/validate";
import {
  changePassword,
  confirmCvUpload,
  prepareCvUpload,
  removeAvatar,
  saveReviewerProfile,
  setAvatar,
  updateProfile,
} from "@/lib/profile";
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
    institution: String(formData.get("institution") ?? ""),
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

export async function saveReviewerProfileAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user } = await requireSession();

  const values = {
    academicRank: String(formData.get("academicRank") ?? ""),
    yearsExperience: String(formData.get("yearsExperience") ?? ""),
    expertise: String(formData.get("expertise") ?? ""),
    disciplineIds: formData.getAll("disciplineIds").map(String).join(","),
  };
  const parsed = reviewerProfileSchema.safeParse({
    ...values,
    disciplineIds: formData.getAll("disciplineIds").map(String),
  });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await saveReviewerProfile(user, parsed.data);
  if (!result.ok) {
    return { error: "Only submitters and reviewers have a reviewer profile.", values };
  }

  refresh();
  return { success: true, values: { ...values, became: result.becameReviewer ? "yes" : "" } };
}

export async function prepareCvUploadAction(file: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ url: string; key: string; mimeType: string } | { error: string }> {
  const { user } = await requireSession();
  const result = await prepareCvUpload(user.id, {
    filename: String(file.filename),
    mimeType: String(file.mimeType),
    sizeBytes: Number(file.sizeBytes),
  });
  if (!result.ok) {
    if (result.reason === "no_profile") return { error: "Save your reviewer details first." };
    if (result.reason === "unsupported_type") {
      return { error: "Upload your CV as a PDF or Word file." };
    }
    return { error: REJECTION_MESSAGE[result.reason] };
  }
  return { url: result.url, key: result.key, mimeType: result.mimeType };
}

export async function confirmCvUploadAction(
  key: string,
  filename: string,
): Promise<{ error?: string }> {
  const { user } = await requireSession();
  const result = await confirmCvUpload(user.id, String(key), String(filename));
  if (!result.ok) {
    if (result.reason === "no_profile") return { error: "Save your reviewer details first." };
    if (result.reason === "not_uploaded") {
      return { error: "The upload did not finish. Please try again." };
    }
    return { error: REJECTION_MESSAGE[result.reason] };
  }
  revalidatePath("/profile");
  return {};
}
