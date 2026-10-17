"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { getRequestMetadata } from "@/lib/auth/request";
import { type FormState, zodFieldErrors } from "@/lib/auth/schemas";
import { REJECTION_MESSAGE } from "@/lib/files/validate";
import {
  confirmUpload,
  createDraft,
  type DetailsFailure,
  prepareUpload,
  submitPaper,
  updatePaper,
  withdrawPaper,
} from "@/lib/submissions";
import { OTHER, paperDetailsSchema, resolvePaperDetails } from "@/lib/submissions/schema";

/**
 * Server actions for a submitter's papers. Each starts with `requireRole`;
 * ownership of the particular paper is enforced inside lib/submissions, which
 * scopes every query to the submitter.
 */

const SUBMITTERS = ["USER", "REVIEWER"] as const;

const NOT_EDITABLE = "This paper is with reviewers now, so it can no longer be changed.";

const DETAILS_FAILURE: Record<DetailsFailure, FormState> = {
  conference_closed: { error: "This conference is no longer taking papers." },
  unknown_discipline: { fieldErrors: { disciplineId: ["Choose the broad area of research."] } },
  unknown_topic: { fieldErrors: { topic: ["Choose a topic from the list, or Other."] } },
};

function detailsFrom(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  return {
    title: field("title"),
    authorNames: field("authorNames"),
    contactEmail: field("contactEmail"),
    institution: field("institution"),
    topic: field("topic"),
    topicOther: field("topicOther"),
    disciplineId: field("disciplineId"),
    disciplineOther: field("disciplineOther"),
    paperType: field("paperType"),
    abstract: field("abstract"),
  };
}

function detailPath(id: string) {
  return `/dashboard/papers/${id}`;
}

export async function createPaperAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(...SUBMITTERS);
  const conferenceId = String(formData.get("conferenceId") ?? "");

  const values = detailsFrom(formData);
  const parsed = paperDetailsSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await createDraft(
    user,
    conferenceId,
    resolvePaperDetails(parsed.data),
    parsed.data.topic === OTHER,
  );
  if (!result.ok) return { ...DETAILS_FAILURE[result.reason], values };

  revalidatePath("/dashboard");
  redirect(detailPath(result.id));
}

export async function updatePaperAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(...SUBMITTERS);
  const paperId = String(formData.get("paperId") ?? "");

  const values = detailsFrom(formData);
  const parsed = paperDetailsSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await updatePaper(
    user,
    paperId,
    resolvePaperDetails(parsed.data),
    parsed.data.topic === OTHER,
  );
  if (!result.ok) {
    return result.reason === "not_editable"
      ? { values, error: NOT_EDITABLE }
      : { ...DETAILS_FAILURE[result.reason], values };
  }

  revalidatePath("/dashboard");
  redirect(detailPath(paperId));
}

export async function preparePaperUploadAction(
  paperId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<{ url: string; key: string; mimeType: string } | { error: string }> {
  const user = await requireRole(...SUBMITTERS);

  const result = await prepareUpload(user.id, String(paperId), {
    filename: String(file.filename),
    mimeType: String(file.mimeType),
    sizeBytes: Number(file.sizeBytes),
  });
  if (!result.ok) {
    if (result.reason === "not_editable") return { error: NOT_EDITABLE };
    if (result.reason === "unsupported_type")
      return { error: "Upload a PDF or Word (.docx) file." };
    return { error: REJECTION_MESSAGE[result.reason] };
  }
  return { url: result.url, key: result.key, mimeType: result.mimeType };
}

export async function confirmPaperUploadAction(
  paperId: string,
  key: string,
  filename: string,
): Promise<{ error?: string }> {
  const user = await requireRole(...SUBMITTERS);

  const result = await confirmUpload(user, String(paperId), String(key), String(filename));
  if (!result.ok) {
    switch (result.reason) {
      case "not_editable":
        return { error: NOT_EDITABLE };
      case "not_uploaded":
        return { error: "The upload did not finish. Please try again." };
      case "encrypted":
        return { error: "That file is password-protected. Save a copy without a password." };
      case "unreadable":
      case "too_large_unpacked":
        return { error: "That file could not be read. Save it again from Word and retry." };
      default:
        return { error: REJECTION_MESSAGE[result.reason] };
    }
  }

  revalidatePath(detailPath(paperId));
  revalidatePath("/dashboard");
  return {};
}

const SUBMIT_FAILURE: Record<string, string> = {
  no_file: "Attach the full paper before submitting.",
  no_declaration: "Confirm the statement above to submit.",
  conference_closed: "This conference is no longer taking papers.",
  limit_reached:
    "This conference has received all the papers its package allows. Please contact the organisers.",
};

export async function submitPaperAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(...SUBMITTERS);
  const paperId = String(formData.get("paperId") ?? "");
  const declared = formData.get("declaration") === "on";
  const { ip } = await getRequestMetadata();

  const result = await submitPaper(user, paperId, declared, ip);
  if (!result.ok) {
    return {
      error:
        SUBMIT_FAILURE[result.reason] ??
        "This paper could not be submitted. Reload the page and try again.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath(detailPath(paperId));
  return { success: true };
}

export async function withdrawPaperAction(formData: FormData): Promise<void> {
  const user = await requireRole(...SUBMITTERS);
  const paperId = String(formData.get("paperId") ?? "");
  const { ip } = await getRequestMetadata();

  await withdrawPaper(user, paperId, ip);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
