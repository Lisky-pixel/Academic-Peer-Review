"use client";

import { Save, Send } from "lucide-react";
import { useActionState, useState } from "react";
import {
  confirmMarkedUpAction,
  declineAction,
  prepareMarkedUpAction,
  saveReviewAction,
} from "@/app/(reviewer)/reviewer/reviews/[id]/actions";
import { FileUploader } from "@/components/file-uploader";
import { FormError, FormMessage, TextAreaField } from "@/components/form";
import { SCORE_LABEL } from "@/components/score";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";

const INITIAL: FormState = {};

const ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The review itself: a score, a recommendation and comments for the authors. */
export function ReviewForm({
  paperId,
  initial,
}: {
  paperId: string;
  initial: { score: number | null; recommend: boolean | null; comments: string };
}) {
  const [state, action, pending] = useActionState(saveReviewAction, INITIAL);
  const [score, setScore] = useState<number | null>(initial.score);
  const finalErrors = state.fieldErrors?.final;

  return (
    <form action={action} className="space-y-7">
      <FormError state={state} />
      {state.success && <FormMessage tone="success">Draft saved.</FormMessage>}
      <input type="hidden" name="paperId" value={paperId} />

      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-1 font-medium">Overall score</legend>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className={cn(
                "border-input bg-card has-[:focus-visible]:ring-ring/30 flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-1 py-3 text-center transition-colors has-[:focus-visible]:ring-3",
                score === value && "border-mark bg-mark/8",
              )}
            >
              <input
                type="radio"
                name="score"
                value={value}
                defaultChecked={initial.score === value}
                onChange={() => setScore(value)}
                className="sr-only"
              />
              <span className="font-heading text-2xl leading-none tabular-nums">{value}</span>
              <span className="text-muted-foreground text-xs">{SCORE_LABEL[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-1 font-medium">
          Do you recommend this paper for the conference?
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "yes", label: "Yes, recommend it" },
            { value: "no", label: "No, do not recommend it" },
          ].map((option) => (
            <label
              key={option.value}
              className="border-input bg-card has-[:checked]:border-mark has-[:checked]:bg-mark/8 has-[:focus-visible]:ring-ring/30 flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-3"
            >
              <input
                type="radio"
                name="recommend"
                value={option.value}
                defaultChecked={
                  initial.recommend === null
                    ? false
                    : (option.value === "yes") === initial.recommend
                }
                className="accent-mark size-4"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <TextAreaField
        name="comments"
        label="Comments and feedback for the authors"
        rows={12}
        state={state}
        initial={initial.comments}
        required={false}
        hint="The authors will read this once the organisers decide. They will not know it was you."
      />

      <div className="border-border space-y-4 border-t pt-6">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="final"
            className="accent-mark mt-1 size-4 shrink-0"
            aria-describedby={finalErrors ? "final-error" : undefined}
          />
          <span>
            My review is finished. I understand it cannot be changed after I send it.
            {finalErrors && (
              <span id="final-error" className="text-destructive mt-1 block">
                {finalErrors.join(" ")}
              </span>
            )}
          </span>
        </label>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            name="intent"
            value="submit"
            size="lg"
            className="h-11 px-5 text-sm"
            disabled={pending}
          >
            <Send aria-hidden />
            {pending ? "Sending…" : "Send review"}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="save"
            variant="outline"
            size="lg"
            className="h-11 px-5 text-sm"
            disabled={pending}
          >
            <Save aria-hidden />
            Save draft
          </Button>
        </div>
      </div>
    </form>
  );
}

export function MarkedUpUploader({
  paperId,
  current,
  maxBytes,
}: {
  paperId: string;
  current: { filename: string; sizeBytes: number } | null;
  maxBytes: number;
}) {
  return (
    <FileUploader
      current={current}
      maxBytes={maxBytes}
      accept={ACCEPT}
      formats="PDF or Word (.docx)"
      inputLabel="Choose your marked-up copy"
      prepare={(file) => prepareMarkedUpAction(paperId, file)}
      confirm={(key) => confirmMarkedUpAction(paperId, key)}
    />
  );
}

/** Turning a paper down. A conflict of interest needs no further reason. */
export function DeclineForm({ paperId }: { paperId: string }) {
  const [state, action, pending] = useActionState(declineAction, INITIAL);
  const [conflict, setConflict] = useState(false);

  return (
    <details className="group">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-sm underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        I cannot review this paper
      </summary>
      <form action={action} className="border-border mt-4 space-y-4 rounded-2xl border p-5">
        <FormError state={state} />
        <input type="hidden" name="paperId" value={paperId} />
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="conflict"
            onChange={(event) => setConflict(event.target.checked)}
            className="accent-mark mt-1 size-4 shrink-0"
          />
          <span>
            <span className="font-medium">I have a conflict of interest.</span>{" "}
            <span className="text-muted-foreground">
              I know the authors, or I am connected to this work.
            </span>
          </span>
        </label>
        <TextAreaField
          name="reason"
          label={conflict ? "Anything to add (optional)" : "Why can’t you take it?"}
          rows={3}
          state={state}
          required={!conflict}
          hint="Only the organisers see this. The paper goes to another reviewer straight away."
        />
        <Button type="submit" variant="destructive" size="lg" disabled={pending}>
          {pending ? "Declining…" : conflict ? "Declare conflict and decline" : "Decline"}
        </Button>
      </form>
    </details>
  );
}
