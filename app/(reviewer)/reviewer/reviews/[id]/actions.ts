"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { getRequestMetadata } from "@/lib/auth/request";
import type { FormState } from "@/lib/auth/schemas";
import { REJECTION_MESSAGE } from "@/lib/files/validate";
import { isUuid } from "@/lib/format";
import {
  acceptAssignment,
  confirmAnnotatedUpload,
  declineAssignment,
  prepareAnnotatedUpload,
  type ReviewInput,
  saveReview,
  submitReview,
} from "@/lib/reviews";

/**
 * Server actions for a reviewer's work on one paper. Every one starts with
 * `requireRole("REVIEWER")`; lib/reviews scopes every query to papers this
 * reviewer has been given.
 */

const CLOSED = "This review can no longer be changed.";

function pathOf(id: string) {
  return `/reviewer/reviews/${id}`;
}

export async function acceptAction(formData: FormData): Promise<void> {
  const user = await requireRole("REVIEWER");
  const id = String(formData.get("paperId") ?? "");
  if (!isUuid(id)) return;
  const { ip } = await getRequestMetadata();
  await acceptAssignment(user, id, ip);
  revalidatePath(pathOf(id));
  revalidatePath("/reviewer");
}

export async function declineAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("REVIEWER");
  const id = String(formData.get("paperId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const conflict = formData.get("conflict") === "on";
  if (!isUuid(id)) return { error: "This paper could not be found." };

  const { ip } = await getRequestMetadata();
  const result = await declineAssignment(user, id, { reason, conflict }, ip);
  if (!result.ok) {
    return result.reason === "reason_required"
      ? { fieldErrors: { reason: ["Tell the organisers briefly why, so they can plan."] } }
      : { error: "This paper is no longer with you." };
  }
  revalidatePath("/reviewer");
  redirect("/reviewer");
}

function reviewFrom(formData: FormData): ReviewInput {
  const score = Number(formData.get("score"));
  const recommend = formData.get("recommend");
  return {
    score: Number.isInteger(score) && score >= 1 && score <= 5 ? score : null,
    recommend: recommend === "yes" ? true : recommend === "no" ? false : null,
    comments: String(formData.get("comments") ?? ""),
  };
}

export async function saveReviewAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("REVIEWER");
  const id = String(formData.get("paperId") ?? "");
  if (!isUuid(id)) return { error: CLOSED };

  const input = reviewFrom(formData);
  const saved = await saveReview(user, id, input);
  if (!saved.ok) return { error: CLOSED };

  if (formData.get("intent") !== "submit") {
    revalidatePath(pathOf(id));
    return { success: true };
  }

  if (formData.get("final") !== "on") {
    return {
      fieldErrors: { final: ["Tick this to confirm the review is finished."] },
    };
  }

  const { ip } = await getRequestMetadata();
  const result = await submitReview(user, id, ip);
  if (!result.ok) {
    return result.reason === "incomplete"
      ? { error: `Before sending, add ${result.missing.join(", ")}.` }
      : { error: CLOSED };
  }

  revalidatePath("/reviewer");
  revalidatePath(pathOf(id));
  redirect(`${pathOf(id)}?sent=1`);
}

export async function prepareMarkedUpAction(
  paperId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<{ url: string; key: string; mimeType: string } | { error: string }> {
  const user = await requireRole("REVIEWER");
  const result = await prepareAnnotatedUpload(user.id, String(paperId), {
    filename: String(file.filename),
    mimeType: String(file.mimeType),
    sizeBytes: Number(file.sizeBytes),
  });
  if (!result.ok) {
    if (result.reason === "not_editable") return { error: CLOSED };
    if (result.reason === "unsupported_type") {
      return { error: "Upload a PDF or Word (.docx) file, so your name can be removed from it." };
    }
    return { error: REJECTION_MESSAGE[result.reason] };
  }
  return { url: result.url, key: result.key, mimeType: result.mimeType };
}

export async function confirmMarkedUpAction(
  paperId: string,
  key: string,
): Promise<{ error?: string }> {
  const user = await requireRole("REVIEWER");
  const result = await confirmAnnotatedUpload(user, String(paperId), String(key));
  if (!result.ok) {
    switch (result.reason) {
      case "not_editable":
        return { error: CLOSED };
      case "not_uploaded":
        return { error: "The upload did not finish. Please try again." };
      case "encrypted":
        return { error: "That file is password-protected. Save a copy without a password." };
      case "unreadable":
      case "too_large_unpacked":
        return { error: "That file could not be read. Save it again and retry." };
      default:
        return { error: REJECTION_MESSAGE[result.reason] };
    }
  }
  revalidatePath(pathOf(paperId));
  return {};
}
