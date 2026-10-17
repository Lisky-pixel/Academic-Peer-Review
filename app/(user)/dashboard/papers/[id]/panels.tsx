"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";
import {
  confirmPaperUploadAction,
  preparePaperUploadAction,
  submitPaperAction,
  withdrawPaperAction,
} from "@/app/(user)/dashboard/papers/actions";
import { FileUploader } from "@/components/file-uploader";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

const PAPER_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The paper file on a paper that can still be edited. */
export function PaperUploader({
  paperId,
  file,
  maxBytes,
}: {
  paperId: string;
  file: { filename: string; sizeBytes: number } | null;
  maxBytes: number;
}) {
  return (
    <FileUploader
      current={file}
      maxBytes={maxBytes}
      accept={PAPER_ACCEPT}
      formats="PDF or Word (.docx)"
      inputLabel="Choose your paper"
      prepare={(chosen) => preparePaperUploadAction(paperId, chosen)}
      confirm={(key, filename) => confirmPaperUploadAction(paperId, key, filename)}
    />
  );
}

export function SubmitPanel({
  paperId,
  canSubmit,
  missing,
}: {
  paperId: string;
  canSubmit: boolean;
  /** Why it cannot be submitted yet, if it cannot. */
  missing: string | null;
}) {
  const [state, action, pending] = useActionState(submitPaperAction, INITIAL);

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      <input type="hidden" name="paperId" value={paperId} />
      <label className="border-border bg-card flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed">
        <input
          type="checkbox"
          name="declaration"
          required
          disabled={!canSubmit}
          className="accent-mark mt-1 size-4 shrink-0"
        />
        <span>
          I confirm this paper is the authors’ original work, has not been published elsewhere, and
          that the uploaded file does not contain the authors’ names, so it can be reviewed
          anonymously.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-5 text-sm"
          disabled={!canSubmit || pending}
        >
          <Send aria-hidden />
          {pending ? "Submitting…" : "Submit paper"}
        </Button>
        <p className="text-muted-foreground text-sm">
          {missing ?? "You can still edit it until it is sent to reviewers."}
        </p>
      </div>
    </form>
  );
}

/**
 * Withdrawing cannot be undone, so it takes two deliberate clicks: one to
 * reveal the button and one to press it.
 */
export function WithdrawPanel({ paperId, isDraft }: { paperId: string; isDraft: boolean }) {
  return (
    <details className="group text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        {isDraft ? "Discard this draft" : "Withdraw this paper"}
      </summary>
      <form
        action={withdrawPaperAction}
        className="border-border mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border p-4"
      >
        <input type="hidden" name="paperId" value={paperId} />
        <p className="text-muted-foreground min-w-0 flex-1 basis-60 leading-relaxed">
          {isDraft
            ? "The draft will be discarded. This cannot be undone."
            : "It will not be reviewed. This cannot be undone."}
        </p>
        <Button type="submit" variant="destructive" size="lg">
          {isDraft ? "Discard draft" : "Withdraw"}
        </Button>
      </form>
    </details>
  );
}
