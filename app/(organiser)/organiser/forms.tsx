"use client";

import { Gavel, Shuffle, UserPlus } from "lucide-react";
import { useActionState } from "react";
import {
  assignReviewerAction,
  decideAction,
  runMatchingAction,
} from "@/app/(organiser)/organiser/actions";
import { ChoiceGroup, FormError, FormMessage, TextAreaField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";
import { CONTROL } from "@/components/form";

const INITIAL: FormState = {};

/** Matches reviewers to every paper waiting for them, now rather than at the close. */
export function RunMatchingForm({ conferenceId }: { conferenceId: string }) {
  const [state, action, pending] = useActionState(runMatchingAction, INITIAL);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        <Shuffle aria-hidden />
        {pending ? "Matching…" : "Match reviewers now"}
      </Button>
      {state.success && state.values?.message && (
        <FormMessage tone="success">{state.values.message}</FormMessage>
      )}
    </form>
  );
}

export type ReviewerOption = {
  id: string;
  name: string;
  institution: string | null;
  rank: string | null;
  matchesDiscipline: boolean;
  conflict: boolean;
  load: number;
};

/** Gives the paper to a reviewer of the organiser's choosing. */
export function AssignReviewerForm({
  conferenceId,
  paperId,
  options,
  maxLoad,
}: {
  conferenceId: string;
  paperId: string;
  options: ReviewerOption[];
  maxLoad: number;
}) {
  const [state, action, pending] = useActionState(assignReviewerAction, INITIAL);

  if (options.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Every reviewer on the platform has already been asked about this paper.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <FormError state={state} />
      {state.success && <FormMessage tone="success">Reviewer assigned and emailed.</FormMessage>}
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <input type="hidden" name="paperId" value={paperId} />
      <div className="space-y-2">
        <Label htmlFor="reviewerId">Add a reviewer</Label>
        <select
          id="reviewerId"
          name="reviewerId"
          required
          defaultValue=""
          className={`${CONTROL} h-10`}
        >
          <option value="" disabled>
            Choose a reviewer
          </option>
          {options.map((option) => {
            const notes = [
              option.matchesDiscipline ? "same discipline" : "other discipline",
              `${option.load}/${maxLoad} papers`,
              option.conflict ? "same institution" : null,
            ].filter(Boolean);
            return (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.institution ? ` (${option.institution})` : ""} — {notes.join(", ")}
              </option>
            );
          })}
        </select>
        <p className="text-muted-foreground text-sm">
          Best matches are listed first. Workload and institution are shown but not enforced here.
        </p>
      </div>
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        <UserPlus aria-hidden />
        {pending ? "Assigning…" : "Assign"}
      </Button>
    </form>
  );
}

/** Accept or reject, with an optional message to the authors. */
export function DecisionForm({
  conferenceId,
  paperId,
  waitingFor,
}: {
  conferenceId: string;
  paperId: string;
  /** Reviews still open; deciding now cancels them. */
  waitingFor: number;
}) {
  const [state, action, pending] = useActionState(decideAction, INITIAL);

  if (state.success) {
    return (
      <FormMessage tone="success">Decision saved. The submitter has been emailed.</FormMessage>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <input type="hidden" name="paperId" value={paperId} />
      <ChoiceGroup
        name="decision"
        legend="Decision"
        state={state}
        options={[
          { value: "accept", label: "Accept", detail: "The paper is accepted for the conference." },
          { value: "reject", label: "Reject", detail: "The paper is not accepted." },
        ]}
      />
      <TextAreaField
        name="note"
        label="Message to the authors (optional)"
        rows={4}
        state={state}
        required={false}
        hint="Sent with the decision. The reviews are shown to them as well."
      />
      {waitingFor > 0 && (
        <p className="text-warning text-sm">
          {waitingFor === 1 ? "One review is" : `${waitingFor} reviews are`} still open. Deciding
          now cancels {waitingFor === 1 ? "it" : "them"}.
        </p>
      )}
      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        <Gavel aria-hidden />
        {pending ? "Saving…" : "Save decision"}
      </Button>
    </form>
  );
}
