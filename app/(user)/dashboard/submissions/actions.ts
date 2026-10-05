"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markDelivered } from "@/lib/approvals";
import { requireRole } from "@/lib/auth/guards";
import { getRequestMetadata } from "@/lib/auth/request";
import { type FormState, zodFieldErrors } from "@/lib/auth/schemas";
import { REJECTION_MESSAGE } from "@/lib/files/validate";
import { isUuid } from "@/lib/format";
import {
  confirmUpload,
  createDraft,
  prepareUpload,
  submitDraft,
  updateDraft,
  withdrawSubmission,
} from "@/lib/submissions";
import { submissionDetailsSchema } from "@/lib/submissions/schema";

/**
 * Server actions for an author's submissions. Each starts with
 * `requireRole("USER")`; ownership of the particular submission is enforced
 * inside lib/submissions, which scopes every query to the author.
 */

const NOT_EDITABLE = "This submission can no longer be changed.";

function detailsFrom(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  return {
    title: field("title"),
    documentTypeId: field("documentTypeId"),
    purpose: field("purpose"),
    description: field("description"),
    instructions: field("instructions"),
    focusAreas: field("focusAreas"),
    deadline: field("deadline"),
  };
}

function detailPath(id: string) {
  return `/dashboard/submissions/${id}`;
}

export async function createDraftAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("USER");

  const values = detailsFrom(formData);
  const parsed = submissionDetailsSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await createDraft(user, parsed.data);
  if (!result.ok) {
    return { values, fieldErrors: { documentTypeId: ["Choose what kind of document this is."] } };
  }

  revalidatePath("/dashboard");
  redirect(detailPath(result.id));
}

export async function updateDraftAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("USER");
  const submissionId = String(formData.get("submissionId") ?? "");

  const values = detailsFrom(formData);
  const parsed = submissionDetailsSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await updateDraft(user.id, submissionId, parsed.data);
  if (!result.ok) {
    return result.reason === "not_editable"
      ? { values, error: NOT_EDITABLE }
      : { values, fieldErrors: { documentTypeId: ["Choose what kind of document this is."] } };
  }

  revalidatePath("/dashboard");
  redirect(detailPath(submissionId));
}

export async function prepareUploadAction(
  submissionId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<{ url: string; key: string; mimeType: string } | { error: string }> {
  const user = await requireRole("USER");

  const result = await prepareUpload(user.id, submissionId, {
    filename: String(file.filename),
    mimeType: String(file.mimeType),
    sizeBytes: Number(file.sizeBytes),
  });
  if (!result.ok) {
    return {
      error: result.reason === "not_editable" ? NOT_EDITABLE : REJECTION_MESSAGE[result.reason],
    };
  }
  return { url: result.url, key: result.key, mimeType: result.mimeType };
}

export async function confirmUploadAction(
  submissionId: string,
  key: string,
  filename: string,
): Promise<{ error?: string }> {
  const user = await requireRole("USER");

  const result = await confirmUpload(user, submissionId, String(key), String(filename));
  if (!result.ok) {
    if (result.reason === "not_editable") return { error: NOT_EDITABLE };
    if (result.reason === "not_uploaded") {
      return { error: "The upload did not finish. Please try again." };
    }
    return { error: REJECTION_MESSAGE[result.reason] };
  }

  revalidatePath(detailPath(submissionId));
  revalidatePath("/dashboard");
  return {};
}

export async function submitAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("USER");
  const submissionId = String(formData.get("submissionId") ?? "");
  const { ip } = await getRequestMetadata();

  const result = await submitDraft(user, submissionId, ip);
  if (!result.ok) {
    return {
      error:
        result.reason === "no_document"
          ? "Attach your document before submitting."
          : "This submission could not be submitted. Reload the page and try again.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath(detailPath(submissionId));
  return { success: true };
}

export async function withdrawAction(formData: FormData): Promise<void> {
  const user = await requireRole("USER");
  const submissionId = String(formData.get("submissionId") ?? "");
  const { ip } = await getRequestMetadata();

  await withdrawSubmission(user, submissionId, ip);

  revalidatePath("/dashboard");
  revalidatePath(detailPath(submissionId));
  redirect("/dashboard");
}

/** Called by the browser once the author has their approved review on screen. */
export async function markDeliveredAction(submissionId: string): Promise<void> {
  const user = await requireRole("USER");
  if (!isUuid(submissionId)) return;

  await markDelivered(user.id, submissionId, "view");
  revalidatePath("/dashboard");
}
