"use client";

import { useActionState } from "react";
import { assignAction } from "@/app/(admin)/admin/submissions/[id]/actions";
import { Field, FormError, FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";
import type { ReviewerOptionDTO } from "@/lib/dto/assignment";
import { cn } from "@/lib/utils";

const INITIAL: FormState = {};

function workloadText(reviewer: ReviewerOptionDTO): string {
  if (reviewer.activeCount === 0) return "Nothing in progress";
  return `${reviewer.activeCount} in progress`;
}

/**
 * Choose a reviewer, with each one's current load beside their name so the
 * choice is informed rather than habitual. With `currentReviewerId` this
 * reassigns, which also asks for a reason.
 */
export function AssignForm({
  submissionId,
  reviewers,
  currentReviewerId,
  defaultDueAt,
  minDueAt,
}: {
  submissionId: string;
  reviewers: ReviewerOptionDTO[];
  currentReviewerId?: string;
  /** Date-input value to start from: the author's deadline, if there is one. */
  defaultDueAt: string;
  minDueAt: string;
}) {
  const [state, action, pending] = useActionState(assignAction, INITIAL);
  const reassign = Boolean(currentReviewerId);
  const reviewerErrors = state.fieldErrors?.reviewerId;
  const reasonErrors = state.fieldErrors?.reason;
  const choices = reviewers.filter((reviewer) => reviewer.id !== currentReviewerId);

  if (choices.length === 0) {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed">
        {reassign
          ? "There is no other active reviewer to give this to. Invite one from Invitations."
          : "There are no active reviewers yet. Invite one from Invitations."}
      </p>
    );
  }

  return (
    // Keyed on success so the choices clear once the assignment is made.
    <form action={action} className="space-y-6" key={state.success ? "done" : "choosing"}>
      <FormError state={state} />
      {state.success && (
        <FormMessage tone="success">
          {reassign ? "Reassigned." : "Assigned."} The reviewer has been notified.
        </FormMessage>
      )}
      <input type="hidden" name="submissionId" value={submissionId} />
      {reassign && <input type="hidden" name="mode" value="reassign" />}

      <fieldset className="min-w-0 space-y-3">
        <legend className="text-sm font-medium">{reassign ? "Give it to" : "Reviewer"}</legend>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {choices.map((reviewer) => (
            <label
              key={reviewer.id}
              className="border-border bg-card has-checked:border-mark has-checked:ring-mark/25 has-focus-visible:ring-ring/40 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-checked:ring-3 has-focus-visible:ring-3"
            >
              <input
                type="radio"
                name="reviewerId"
                value={reviewer.id}
                required
                defaultChecked={state.values?.reviewerId === reviewer.id}
                className="accent-mark mt-1"
              />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block truncate text-sm font-medium">{reviewer.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {reviewer.email}
                </span>
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1 text-xs">
                  <span
                    className={cn(
                      reviewer.activeCount === 0 ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {workloadText(reviewer)}
                  </span>
                  {reviewer.overdueCount > 0 && (
                    <span className="text-warning font-medium">
                      {reviewer.overdueCount} overdue
                    </span>
                  )}
                </span>
              </span>
            </label>
          ))}
        </div>
        {reviewerErrors && <p className="text-destructive text-sm">{reviewerErrors.join(" ")}</p>}
      </fieldset>

      <Field
        name="dueAt"
        label="Review due"
        type="date"
        min={minDueAt}
        required={false}
        hint="When the reviewer should finish. Defaults to the date the author asked for."
        state={state}
        defaultValue={state.values?.dueAt ?? defaultDueAt}
        className="sm:max-w-56"
      />

      {reassign && (
        <div className="space-y-2">
          <Label htmlFor="reason">Reason for reassigning</Label>
          <textarea
            id="reason"
            name="reason"
            rows={2}
            required
            maxLength={500}
            defaultValue={state.values?.reason}
            aria-invalid={reasonErrors ? true : undefined}
            className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-xs outline-none focus-visible:ring-3"
          />
          <p
            className={reasonErrors ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
          >
            {reasonErrors
              ? reasonErrors.join(" ")
              : "Kept in the activity log. The reviewers are not shown it."}
          </p>
        </div>
      )}

      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        {pending ? "Saving…" : reassign ? "Reassign" : "Assign reviewer"}
      </Button>
    </form>
  );
}
