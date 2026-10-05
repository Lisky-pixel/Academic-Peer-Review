"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";
import { submitAction, withdrawAction } from "@/app/(user)/dashboard/submissions/actions";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

export function SubmitPanel({
  submissionId,
  canSubmit,
}: {
  submissionId: string;
  canSubmit: boolean;
}) {
  const [state, action, pending] = useActionState(submitAction, INITIAL);

  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-5 text-sm"
          disabled={!canSubmit || pending}
        >
          <Send aria-hidden />
          {pending ? "Submitting…" : "Submit for review"}
        </Button>
        <p className="text-muted-foreground text-sm">
          {canSubmit
            ? "Once submitted, the details and document can no longer be changed."
            : "Attach your document to submit."}
        </p>
      </div>
    </form>
  );
}

/**
 * Withdrawing cannot be undone, so it takes two deliberate clicks: one to
 * reveal the button and one to press it. A disclosure element does this
 * without a dialog and works with JavaScript switched off.
 */
export function WithdrawPanel({
  submissionId,
  isDraft,
}: {
  submissionId: string;
  isDraft: boolean;
}) {
  return (
    <details className="group text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        {isDraft ? "Discard this draft" : "Withdraw this submission"}
      </summary>
      <form
        action={withdrawAction}
        className="border-border mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border p-4"
      >
        <input type="hidden" name="submissionId" value={submissionId} />
        <p className="text-muted-foreground min-w-0 flex-1 basis-60 leading-relaxed">
          {isDraft
            ? "The draft will be cancelled. This cannot be undone."
            : "It will not be sent to a reviewer. This cannot be undone."}
        </p>
        <Button type="submit" variant="destructive" size="lg">
          {isDraft ? "Discard draft" : "Withdraw"}
        </Button>
      </form>
    </details>
  );
}
