"use server";

import { revalidatePath } from "next/cache";
import { approveReview, type DecisionFailure, requestRevision } from "@/lib/approvals";
import { requireRole } from "@/lib/auth/guards";
import { getRequestMetadata } from "@/lib/auth/request";
import type { FormState } from "@/lib/auth/schemas";
import { isUuid } from "@/lib/format";

const MOVED_ON = "This review has changed since the page loaded. Reload to see where it stands.";

const MESSAGE: Record<DecisionFailure, string> = {
  not_found: "That submission no longer exists.",
  not_yours: "You cannot decide on this review.",
  role_not_allowed: "You cannot decide on this review.",
  illegal_from_this_status: MOVED_ON,
  changed_meanwhile: MOVED_ON,
  no_review: "There is no submitted review to decide on.",
  not_scrubbed:
    "The annotated file has not been cleaned of the reviewer's details, so it cannot be released. Ask the reviewer to upload it again.",
  note_required: "Say what the reviewer should change.",
};

function refresh(submissionId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/submissions/${submissionId}`);
}

export async function approveAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const submissionId = String(formData.get("submissionId") ?? "");
  if (!isUuid(submissionId)) return { error: MESSAGE.not_found };

  const { ip } = await getRequestMetadata();
  const result = await approveReview(admin, submissionId, "", ip);
  if (!result.ok) return { error: MESSAGE[result.reason] };

  refresh(submissionId);
  return { success: true };
}

export async function requestRevisionAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const submissionId = String(formData.get("submissionId") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!isUuid(submissionId)) return { error: MESSAGE.not_found };

  const { ip } = await getRequestMetadata();
  const result = await requestRevision(admin, submissionId, note, ip);
  if (!result.ok) {
    return result.reason === "note_required"
      ? { values: { note }, fieldErrors: { note: [MESSAGE.note_required] } }
      : { values: { note }, error: MESSAGE[result.reason] };
  }

  refresh(submissionId);
  return { success: true };
}
