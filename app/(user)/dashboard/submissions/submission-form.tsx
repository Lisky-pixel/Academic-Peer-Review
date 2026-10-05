"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createDraftAction, updateDraftAction } from "@/app/(user)/dashboard/submissions/actions";
import { Field, FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

const CONTROL =
  "border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive w-full rounded-lg border px-3 text-sm shadow-xs outline-none focus-visible:ring-3";

export type SubmissionFormValues = {
  title: string;
  documentTypeId: string;
  purpose: string;
  description: string;
  instructions: string;
  focusAreas: string;
  deadline: string;
};

function TextArea({
  name,
  label,
  hint,
  rows = 3,
  state,
  initial,
}: {
  name: keyof SubmissionFormValues;
  label: string;
  hint: string;
  rows?: number;
  state: FormState;
  initial: string;
}) {
  const errors = state.fieldErrors?.[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={state.values?.[name] ?? initial}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${name}-hint`}
        className={`${CONTROL} resize-y py-2 leading-relaxed`}
      />
      <p
        id={`${name}-hint`}
        className={errors ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
      >
        {errors ? errors.join(" ") : hint}
      </p>
    </div>
  );
}

/**
 * The details of a submission. Used both to start a draft and to edit one;
 * with `submissionId` it saves changes, without it it creates the draft.
 */
export function SubmissionForm({
  documentTypes,
  submissionId,
  initial,
  minDeadline,
}: {
  documentTypes: Array<{ id: string; name: string }>;
  submissionId?: string;
  initial: SubmissionFormValues;
  /** Earliest selectable deadline, "YYYY-MM-DD". */
  minDeadline: string;
}) {
  const [state, action, pending] = useActionState(
    submissionId ? updateDraftAction : createDraftAction,
    INITIAL,
  );
  const typeErrors = state.fieldErrors?.documentTypeId;

  return (
    <form action={action} className="space-y-10">
      <FormError state={state} />
      {submissionId && <input type="hidden" name="submissionId" value={submissionId} />}

      <fieldset className="space-y-5">
        <legend className="font-heading text-xl font-medium">The document</legend>
        <Field
          name="title"
          label="Title"
          placeholder="e.g. Personal statement for MSc Transport Planning"
          state={state}
          defaultValue={state.values?.title ?? initial.title}
        />

        <div className="space-y-2">
          <Label htmlFor="documentTypeId">Type of document</Label>
          <select
            id="documentTypeId"
            name="documentTypeId"
            required
            defaultValue={state.values?.documentTypeId ?? initial.documentTypeId}
            aria-invalid={typeErrors ? true : undefined}
            className={`${CONTROL} h-10`}
          >
            <option value="" disabled>
              Choose one
            </option>
            {documentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <p className={typeErrors ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
            {typeErrors
              ? typeErrors.join(" ")
              : "This decides the criteria your reviewer scores it against."}
          </p>
        </div>

        <TextArea
          name="purpose"
          label="What is it for?"
          hint="Optional. The course, job or audience this is written for."
          rows={2}
          state={state}
          initial={initial.purpose}
        />
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-heading text-xl font-medium">For your reviewer</legend>
        <TextArea
          name="instructions"
          label="Instructions"
          hint="Optional. Word limits, the prompt you were given, anything they must know."
          rows={4}
          state={state}
          initial={initial.instructions}
        />
        <TextArea
          name="focusAreas"
          label="Where should they focus?"
          hint="Optional. For example: the opening paragraph, structure, or tone."
          state={state}
          initial={initial.focusAreas}
        />
        <TextArea
          name="description"
          label="Anything else"
          hint="Optional. Background that helps them read it the way you intend."
          state={state}
          initial={initial.description}
        />
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-heading text-xl font-medium">Timing</legend>
        <Field
          name="deadline"
          label="When do you need it back?"
          type="date"
          min={minDeadline}
          required={false}
          hint="Optional. Leave blank if there is no rush."
          state={state}
          defaultValue={state.values?.deadline ?? initial.deadline}
          className="sm:max-w-56"
        />
      </fieldset>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-8">
        <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
          {pending ? "Saving…" : submissionId ? "Save changes" : "Save and continue"}
        </Button>
        <Button asChild variant="ghost" size="lg" className="h-10 px-4 text-sm">
          <Link href={submissionId ? `/dashboard/submissions/${submissionId}` : "/dashboard"}>
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
