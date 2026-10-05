"use server";

import { revalidatePath } from "next/cache";
import {
  type AssignFailure,
  assignReviewer,
  reassignReviewer,
  setAuthorVisibility,
} from "@/lib/assignments";
import { requireRole } from "@/lib/auth/guards";
import { getRequestMetadata } from "@/lib/auth/request";
import type { FormState } from "@/lib/auth/schemas";
import { isUuid } from "@/lib/format";

const MESSAGE: Record<AssignFailure, string> = {
  not_found: "That submission no longer exists.",
  not_yours: "You cannot change this submission.",
  role_not_allowed: "You cannot change this submission.",
  illegal_from_this_status:
    "This submission has moved on since the page loaded. Reload to see where it stands.",
  changed_meanwhile:
    "Someone else changed this submission at the same moment. Reload to see where it stands.",
  reviewer_unavailable: "That reviewer is no longer available. Choose another.",
  same_reviewer: "That reviewer already has this submission. Choose a different one.",
  due_in_past: "Choose a due date in the future.",
  reason_required: "Say why this is being reassigned.",
};

/** "YYYY-MM-DD" from a date input → the end of that day, or null if blank. */
function parseDueDate(value: string): Date | null | "invalid" {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid";
  const date = new Date(`${value}T23:59:59.000Z`);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function refresh(submissionId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/submissions/${submissionId}`);
}

/** Assigns, or reassigns when the form carries `mode=reassign`. */
export async function assignAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");

  const submissionId = String(formData.get("submissionId") ?? "");
  const reviewerId = String(formData.get("reviewerId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const dueValue = String(formData.get("dueAt") ?? "");
  const reassign = formData.get("mode") === "reassign";
  const values = { reviewerId, reason, dueAt: dueValue };

  if (!isUuid(submissionId)) return { error: MESSAGE.not_found, values };
  if (!isUuid(reviewerId)) {
    return { values, fieldErrors: { reviewerId: ["Choose a reviewer."] } };
  }
  const dueAt = parseDueDate(dueValue);
  if (dueAt === "invalid") return { values, fieldErrors: { dueAt: ["Enter a valid date."] } };

  const { ip } = await getRequestMetadata();
  const input = { submissionId, reviewerId, admin, dueAt, ip };
  const result = reassign
    ? await reassignReviewer({ ...input, reason })
    : await assignReviewer(input);

  if (!result.ok) {
    const message = MESSAGE[result.reason];
    if (result.reason === "due_in_past") return { values, fieldErrors: { dueAt: [message] } };
    if (result.reason === "reason_required") return { values, fieldErrors: { reason: [message] } };
    if (result.reason === "same_reviewer" || result.reason === "reviewer_unavailable") {
      return { values, fieldErrors: { reviewerId: [message] } };
    }
    return { values, error: message };
  }

  refresh(submissionId);
  return { success: true };
}

export async function setAuthorVisibilityAction(formData: FormData): Promise<void> {
  const admin = await requireRole("ADMIN");

  const submissionId = String(formData.get("submissionId") ?? "");
  if (!isUuid(submissionId)) return;

  await setAuthorVisibility(submissionId, formData.get("visible") === "true", admin);
  refresh(submissionId);
}
