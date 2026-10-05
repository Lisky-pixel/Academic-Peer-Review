"use client";

import { Check, CircleAlert, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmAnnotatedUploadAction,
  prepareAnnotatedUploadAction,
  saveDraftAction,
  submitReviewAction,
} from "@/app/(reviewer)/reviewer/reviews/[id]/actions";
import { FileUploader } from "@/components/file-uploader";
import { FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { AnswerDTO, CriterionDTO } from "@/lib/dto/review";
import { COMMENT_MAX, isAnswered } from "@/lib/reviews/completeness";
import { cn } from "@/lib/utils";

const AUTOSAVE_DELAY_MS = 1200;
const EMPTY: AnswerDTO = { rating: null, comment: null };

type SaveState = "idle" | "saving" | "saved" | "failed";

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const [Icon, text, tone] =
    state === "saving"
      ? ([LoaderCircle, "Saving…", "text-muted-foreground"] as const)
      : state === "saved"
        ? ([Check, "All changes saved", "text-muted-foreground"] as const)
        : ([
            CircleAlert,
            "Could not save. Retrying on your next change.",
            "text-destructive",
          ] as const);
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-xs", tone)}>
      <Icon aria-hidden className={cn("size-3.5", state === "saving" && "animate-spin")} />
      {text}
    </span>
  );
}

function RatingInput({
  criterion,
  value,
  onChange,
}: {
  criterion: CriterionDTO;
  value: number | null;
  onChange: (rating: number | null) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${criterion.label} rating, out of ${criterion.maxRating}`}
      className="flex flex-wrap items-center gap-1.5"
    >
      {Array.from({ length: criterion.maxRating }, (_, index) => index + 1).map((rating) => (
        <label
          key={rating}
          className="border-border bg-card has-checked:border-mark has-checked:bg-mark has-checked:text-background has-focus-visible:ring-ring/40 hover:border-ring flex size-9 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium tabular-nums transition-colors has-focus-visible:ring-3"
        >
          <input
            type="radio"
            name={`rating-${criterion.id}`}
            value={rating}
            checked={value === rating}
            onChange={() => onChange(rating)}
            // Clicking the chosen score again clears it.
            onClick={() => value === rating && onChange(null)}
            className="sr-only"
          />
          {rating}
        </label>
      ))}
      <span className="text-muted-foreground pl-1 text-xs">
        {value
          ? `${value} of ${criterion.maxRating}`
          : `1 is weak, ${criterion.maxRating} is strong`}
      </span>
    </div>
  );
}

/**
 * The template-driven review form, the annotated-file upload, and submit.
 *
 * Answers save themselves a moment after the reviewer stops typing. Only the
 * criteria that changed are sent, so two saves can never overwrite each
 * other's fields, and a failed save is retried with the next one.
 */
export function ReviewForm({
  submissionId,
  criteria,
  initialAnswers,
  annotated,
  maxBytes,
  revisionRequested,
}: {
  submissionId: string;
  criteria: CriterionDTO[];
  initialAnswers: Record<string, AnswerDTO>;
  annotated: { filename: string; sizeBytes: number } | null;
  maxBytes: number;
  revisionRequested: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState(initialAnswers);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; missing?: string[] }>();

  // Refs, not state: autosave must always see the latest answers and the
  // current set of unsaved criteria, whichever render scheduled it.
  const latest = useRef(answers);
  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // One save at a time, so they reach the server in order.
    if (inFlight.current) await inFlight.current;
    if (dirty.current.size === 0) return true;

    const ids = [...dirty.current];
    dirty.current.clear();
    setSaveState("saving");

    const request = saveDraftAction(
      submissionId,
      ids.map((criterionId) => ({ criterionId, ...(latest.current[criterionId] ?? EMPTY) })),
    )
      .then((result) => result.ok)
      .catch(() => false)
      .then((ok) => {
        // Anything that failed to save is still unsaved.
        if (!ok) ids.forEach((id) => dirty.current.add(id));
        setSaveState(ok ? "saved" : "failed");
        return ok;
      });

    inFlight.current = request;
    const ok = await request;
    inFlight.current = null;
    return ok;
  }, [submissionId]);

  function update(criterionId: string, change: Partial<AnswerDTO>) {
    const next = {
      ...latest.current,
      [criterionId]: { ...EMPTY, ...latest.current[criterionId], ...change },
    };
    latest.current = next;
    setAnswers(next);
    dirty.current.add(criterionId);
    setError(undefined);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  // Closing the tab mid-sentence should not lose the sentence.
  useEffect(() => {
    const onHide = () => {
      if (dirty.current.size > 0) void flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    try {
      if (!(await flush())) {
        setError({
          message: "Your latest changes could not be saved. Check your connection and try again.",
        });
        return;
      }
      const result = await submitReviewAction(submissionId);
      if (!result.ok) {
        setError({
          message: result.error ?? "The review could not be submitted.",
          missing: result.missing,
        });
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const required = criteria.filter((criterion) => criterion.required);
  const answered = required.filter((criterion) => isAnswered(criterion, answers[criterion.id]));

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-heading text-xl font-medium">Your review</h2>
          <SaveIndicator state={saveState} />
        </div>

        <ol className="space-y-8">
          {criteria.map((criterion) => {
            const answer = answers[criterion.id] ?? EMPTY;
            const commentId = `comment-${criterion.id}`;
            return (
              <li key={criterion.id} className="space-y-3">
                <div>
                  <p className="font-medium">
                    {criterion.label}
                    {!criterion.required && (
                      <span className="text-muted-foreground font-normal"> (optional)</span>
                    )}
                  </p>
                  {criterion.helpText && (
                    <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed">
                      {criterion.helpText}
                    </p>
                  )}
                </div>

                {criterion.inputType !== "TEXT" && (
                  <RatingInput
                    criterion={criterion}
                    value={answer.rating}
                    onChange={(rating) => update(criterion.id, { rating })}
                  />
                )}

                {criterion.inputType !== "RATING" && (
                  <textarea
                    id={commentId}
                    aria-label={`${criterion.label} comments`}
                    rows={criterion.inputType === "TEXT" ? 6 : 3}
                    maxLength={COMMENT_MAX}
                    value={answer.comment ?? ""}
                    placeholder={
                      criterion.inputType === "TEXT"
                        ? "Write your feedback for the author"
                        : "What works, and what would improve it (optional)"
                    }
                    onChange={(event) => update(criterion.id, { comment: event.target.value })}
                    onBlur={() => void flush()}
                    className="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-xs outline-none focus-visible:ring-3"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-heading text-xl font-medium">Annotated copy</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            Upload the document with your tracked changes and comments. Your name is removed from
            the file before the author can download it.
          </p>
        </div>
        <FileUploader
          current={annotated}
          maxBytes={maxBytes}
          accept=".pdf,.docx,.txt"
          formats="PDF, DOCX or TXT"
          inputLabel="Choose your annotated copy"
          prepare={(file) => prepareAnnotatedUploadAction(submissionId, file)}
          confirm={(key) => confirmAnnotatedUploadAction(submissionId, key)}
        />
      </section>

      <section className="border-border space-y-4 border-t pt-8">
        {error && (
          <FormMessage tone="error">
            {error.message}
            {error.missing && error.missing.length > 0 && (
              <span className="mt-1 block">Still needed: {error.missing.join(", ")}.</span>
            )}
          </FormMessage>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="button"
            size="lg"
            className="h-11 px-5 text-sm"
            disabled={submitting}
            onClick={() => void submit()}
          >
            <Send aria-hidden />
            {submitting ? "Submitting…" : revisionRequested ? "Resubmit review" : "Submit review"}
          </Button>
          <p className="text-muted-foreground text-sm">
            {answered.length} of {required.length} criteria answered
            {annotated ? "" : " · no annotated copy yet"}
          </p>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          An administrator reads every review before the author sees it.
        </p>
      </section>
    </div>
  );
}
