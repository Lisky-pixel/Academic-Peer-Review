"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { getRequestMetadata } from "@/lib/auth/request";
import type { FormState } from "@/lib/auth/schemas";
import type { ScrubFailure } from "@/lib/files/scrub";
import { type FileRejection, REJECTION_MESSAGE } from "@/lib/files/validate";
import { isUuid } from "@/lib/format";
import {
  acceptAssignment,
  confirmAnnotatedUpload,
  declineAssignment,
  prepareAnnotatedUpload,
  saveReviewDraft,
  submitReview,
} from "@/lib/reviews";
import type { AnswerInput } from "@/lib/reviews/completeness";

/**
 * Server actions for the reviewer. Each starts with `requireRole("REVIEWER")`;
 * that the reviewer holds this particular submission is enforced in
 * lib/reviews and again by the state machine.
 */

const MOVED_ON =
  "This assignment has changed since the page loaded. Reload to see where it stands.";
const NOT_EDITABLE = "This review can no longer be changed.";

const ANNOTATED_MESSAGE: Record<FileRejection | ScrubFailure, string> = {
  ...REJECTION_MESSAGE,
  unsupported_type: "Return your annotated copy as a PDF, DOCX or TXT file.",
  unreadable: "That file could not be read. Save it again from your editor and retry.",
  encrypted: "That PDF is password-protected. Remove the password and upload it again.",
  too_large_unpacked: "That file is too large once unpacked.",
};

function workspacePath(id: string) {
  return `/reviewer/reviews/${id}`;
}

function refresh(id: string) {
  revalidatePath("/reviewer");
  revalidatePath(workspacePath(id));
}

export async function acceptAction(formData: FormData): Promise<void> {
  const reviewer = await requireRole("REVIEWER");
  const submissionId = String(formData.get("submissionId") ?? "");
  if (!isUuid(submissionId)) return;

  const { ip } = await getRequestMetadata();
  await acceptAssignment(reviewer, submissionId, ip);
  refresh(submissionId);
}

export async function declineAction(_state: FormState, formData: FormData): Promise<FormState> {
  const reviewer = await requireRole("REVIEWER");
  const submissionId = String(formData.get("submissionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!isUuid(submissionId)) return { error: MOVED_ON };

  const { ip } = await getRequestMetadata();
  const result = await declineAssignment(reviewer, submissionId, reason, ip);
  if (!result.ok) {
    return result.reason === "reason_required"
      ? { values: { reason }, fieldErrors: { reason: ["Say briefly why you are declining."] } }
      : { values: { reason }, error: MOVED_ON };
  }

  revalidatePath("/reviewer");
  redirect("/reviewer");
}

/** Autosave. Returns a plain result rather than throwing, so the form can retry. */
export async function saveDraftAction(
  submissionId: string,
  answers: AnswerInput[],
): Promise<{ ok: boolean; error?: string }> {
  const reviewer = await requireRole("REVIEWER");
  if (!isUuid(submissionId) || !Array.isArray(answers)) return { ok: false, error: NOT_EDITABLE };

  const { ip } = await getRequestMetadata();
  const result = await saveReviewDraft(
    reviewer,
    submissionId,
    answers.map((answer) => ({
      criterionId: String(answer?.criterionId ?? ""),
      rating: answer?.rating,
      comment: answer?.comment,
    })),
    ip,
  );
  return result.ok ? { ok: true } : { ok: false, error: NOT_EDITABLE };
}

export async function prepareAnnotatedUploadAction(
  submissionId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<{ url: string; key: string; mimeType: string } | { error: string }> {
  const reviewer = await requireRole("REVIEWER");

  const result = await prepareAnnotatedUpload(reviewer.id, submissionId, {
    filename: String(file.filename),
    mimeType: String(file.mimeType),
    sizeBytes: Number(file.sizeBytes),
  });
  if (!result.ok) {
    return {
      error: result.reason === "not_editable" ? NOT_EDITABLE : ANNOTATED_MESSAGE[result.reason],
    };
  }
  return { url: result.url, key: result.key, mimeType: result.mimeType };
}

export async function confirmAnnotatedUploadAction(
  submissionId: string,
  key: string,
): Promise<{ error?: string }> {
  const reviewer = await requireRole("REVIEWER");

  const result = await confirmAnnotatedUpload(reviewer, submissionId, String(key));
  if (!result.ok) {
    if (result.reason === "not_editable") return { error: NOT_EDITABLE };
    if (result.reason === "not_uploaded") {
      return { error: "The upload did not finish. Please try again." };
    }
    return { error: ANNOTATED_MESSAGE[result.reason] };
  }

  revalidatePath(workspacePath(submissionId));
  return {};
}

export async function submitReviewAction(
  submissionId: string,
): Promise<{ ok: boolean; error?: string; missing?: string[] }> {
  const reviewer = await requireRole("REVIEWER");
  if (!isUuid(submissionId)) return { ok: false, error: NOT_EDITABLE };

  const { ip } = await getRequestMetadata();
  const result = await submitReview(reviewer, submissionId, ip);

  if (!result.ok) {
    if (result.reason === "incomplete") {
      return {
        ok: false,
        error: "Some criteria still need an answer before you can submit.",
        missing: result.missing,
      };
    }
    if (result.reason === "no_annotated_file") {
      return { ok: false, error: "Attach your annotated copy of the document before submitting." };
    }
    return { ok: false, error: result.reason === "not_editable" ? NOT_EDITABLE : MOVED_ON };
  }

  refresh(submissionId);
  return { ok: true };
}
