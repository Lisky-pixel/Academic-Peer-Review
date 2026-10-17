"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { getRequestMetadata } from "@/lib/auth/request";
import { createInvite, resendInvite } from "@/lib/auth/invites";
import { type FormState, inviteSchema, zodFieldErrors } from "@/lib/auth/schemas";
import { assignManually, decide, removeReviewer } from "@/lib/conferences";
import { requireOrganiserOf } from "@/lib/conferences/guard";
import { isUuid } from "@/lib/format";
import { runMatching } from "@/lib/matching";

/**
 * Server actions for organisers. Every action about a conference starts with
 * `requireOrganiserOf`, so an organiser can act only on conferences they run.
 */

function conferencePath(id: string) {
  return `/organiser/conferences/${id}`;
}

function paperPath(conferenceId: string, paperId: string) {
  return `${conferencePath(conferenceId)}/papers/${paperId}`;
}

export async function runMatchingAction(_state: FormState, formData: FormData): Promise<FormState> {
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const user = await requireOrganiserOf(conferenceId);

  const summary = await runMatching(conferenceId, user);
  revalidatePath(conferencePath(conferenceId));

  if (summary.papers === 0)
    return { success: true, values: { message: "No papers are waiting for reviewers." } };
  const short =
    summary.stillShort > 0
      ? ` ${summary.stillShort} ${summary.stillShort === 1 ? "paper still needs" : "papers still need"} reviewers; nobody suitable was free.`
      : "";
  return {
    success: true,
    values: {
      message: `${summary.assigned} reviewer ${summary.assigned === 1 ? "place" : "places"} filled across ${summary.papers} ${summary.papers === 1 ? "paper" : "papers"}.${short}`,
    },
  };
}

export async function assignReviewerAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const paperId = String(formData.get("paperId") ?? "");
  const reviewerId = String(formData.get("reviewerId") ?? "");
  const user = await requireOrganiserOf(conferenceId);
  if (!isUuid(paperId) || !isUuid(reviewerId)) return { error: "Choose a reviewer." };

  const result = await assignManually(user, conferenceId, paperId, reviewerId);
  if (!result.ok) {
    const message = {
      not_found: "This paper could not be found.",
      not_assignable: "This paper has been decided, so it cannot be given to a reviewer.",
      already_asked: "That reviewer has already been asked to review this paper.",
      not_a_reviewer: "That person cannot review this paper.",
    }[result.reason];
    return { error: message };
  }
  revalidatePath(paperPath(conferenceId, paperId));
  return { success: true };
}

export async function removeReviewerAction(formData: FormData): Promise<void> {
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const paperId = String(formData.get("paperId") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const user = await requireOrganiserOf(conferenceId);
  if (!isUuid(paperId) || !isUuid(assignmentId)) return;

  await removeReviewer(user, conferenceId, paperId, assignmentId);
  revalidatePath(paperPath(conferenceId, paperId));
}

export async function decideAction(_state: FormState, formData: FormData): Promise<FormState> {
  const conferenceId = String(formData.get("conferenceId") ?? "");
  const paperId = String(formData.get("paperId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "");
  const user = await requireOrganiserOf(conferenceId);
  if (!isUuid(paperId)) return { error: "This paper could not be found." };
  if (decision !== "accept" && decision !== "reject") {
    return { fieldErrors: { decision: ["Choose accept or reject."] }, values: { note } };
  }

  const { ip } = await getRequestMetadata();
  const result = await decide(user, conferenceId, paperId, decision === "accept", note, ip);
  if (!result.ok) {
    return {
      error:
        result.reason === "changed_meanwhile"
          ? "Someone else changed this paper a moment ago. Reload the page to see it."
          : "A decision cannot be made on this paper now.",
      values: { note },
    };
  }
  revalidatePath(paperPath(conferenceId, paperId));
  revalidatePath(conferencePath(conferenceId));
  return { success: true };
}

// ── Inviting reviewers ─────────────────────────────────────────────────────

/** Organisers may invite reviewers, and only reviewers. */
export async function inviteReviewerAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("ORGANISER", "ADMIN");

  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: "REVIEWER",
  };
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await createInvite({ ...parsed.data, role: "REVIEWER", invitedBy: user });
  if (!result.ok) {
    return { values, error: "That email address already has an account on the platform." };
  }
  revalidatePath("/organiser/reviewers");
  return { success: true, values: { email: parsed.data.email } };
}

export async function resendReviewerInviteAction(formData: FormData): Promise<void> {
  const user = await requireRole("ORGANISER", "ADMIN");
  await resendInvite(String(formData.get("userId") ?? ""), user);
  revalidatePath("/organiser/reviewers");
}
