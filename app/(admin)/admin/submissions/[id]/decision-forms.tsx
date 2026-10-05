"use client";

import { Check, Undo2 } from "lucide-react";
import { useActionState } from "react";
import {
  approveAction,
  requestRevisionAction,
} from "@/app/(admin)/admin/submissions/[id]/decision-actions";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

/**
 * The administrator's two choices on a submitted review. Approving is one
 * click; sending it back opens a note, because the reviewer has to be told
 * what to change.
 */
export function DecisionForms({ submissionId }: { submissionId: string }) {
  const [approveState, approve, approving] = useActionState(approveAction, INITIAL);
  const [revisionState, requestRevision, requesting] = useActionState(
    requestRevisionAction,
    INITIAL,
  );
  const noteErrors = revisionState.fieldErrors?.note;
  const busy = approving || requesting;

  return (
    <div className="space-y-5">
      <FormError state={approveState} />

      <form action={approve} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="hidden" name="submissionId" value={submissionId} />
        <Button type="submit" size="lg" className="h-11 px-5 text-sm" disabled={busy}>
          <Check aria-hidden />
          {approving ? "Approving…" : "Approve and release to the author"}
        </Button>
        <p className="text-muted-foreground text-sm">
          The author is told their review is ready. The reviewer stays anonymous.
        </p>
      </form>

      <details className="group text-sm" open={Boolean(revisionState.error || noteErrors)}>
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">
          Send it back to the reviewer instead
        </summary>
        <form
          action={requestRevision}
          className="border-border mt-4 space-y-4 rounded-xl border p-5"
        >
          <FormError state={revisionState} />
          <input type="hidden" name="submissionId" value={submissionId} />
          <div className="space-y-2">
            <Label htmlFor="note">What should the reviewer change?</Label>
            <textarea
              id="note"
              name="note"
              rows={3}
              required
              maxLength={2000}
              defaultValue={revisionState.values?.note}
              aria-invalid={noteErrors ? true : undefined}
              className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-xs outline-none focus-visible:ring-3"
            />
            <p className={noteErrors ? "text-destructive" : "text-muted-foreground"}>
              {noteErrors
                ? noteErrors.join(" ")
                : "The reviewer sees this note. The author never does."}
            </p>
          </div>
          <Button type="submit" variant="outline" size="lg" disabled={busy}>
            <Undo2 aria-hidden />
            {requesting ? "Sending…" : "Request changes"}
          </Button>
        </form>
      </details>
    </div>
  );
}
