"use client";

import { useActionState } from "react";
import { declineAction } from "@/app/(reviewer)/reviewer/reviews/[id]/actions";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

/** Declining needs a reason: the administrator has to find someone else. */
export function DeclineForm({ submissionId }: { submissionId: string }) {
  const [state, action, pending] = useActionState(declineAction, INITIAL);
  const errors = state.fieldErrors?.reason;

  return (
    <details className="group text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        I cannot take this one
      </summary>
      <form action={action} className="border-border mt-4 space-y-4 rounded-xl border p-5">
        <FormError state={state} />
        <input type="hidden" name="submissionId" value={submissionId} />
        <div className="space-y-2">
          <Label htmlFor="reason">Why are you declining?</Label>
          <textarea
            id="reason"
            name="reason"
            rows={2}
            required
            maxLength={1000}
            defaultValue={state.values?.reason}
            aria-invalid={errors ? true : undefined}
            className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-xs outline-none focus-visible:ring-3"
          />
          <p className={errors ? "text-destructive" : "text-muted-foreground"}>
            {errors
              ? errors.join(" ")
              : "Only the administrator sees this. The author is not told."}
          </p>
        </div>
        <Button type="submit" variant="destructive" size="lg" disabled={pending}>
          {pending ? "Declining…" : "Decline assignment"}
        </Button>
      </form>
    </details>
  );
}
