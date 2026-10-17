import { Download, FileText, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The pictures on the landing page.
 *
 * They are drawn in markup rather than shipped as image files: they stay
 * sharp at any size, follow the light and dark themes, and show the product
 * itself — a marked-up page and the review that comes back — instead of a
 * stock photograph of somebody typing.
 *
 * Both are decorative: each is one `role="img"` with a description, and
 * everything inside is hidden from screen readers.
 */

/** A page of a personal statement, mid-review, with a margin note. */
export function AnnotatedPageVisual({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A page of a conference paper with a highlighted sentence, a suggested edit and a note from an anonymous reviewer."
      className={cn("relative mx-auto w-full max-w-md", className)}
    >
      {/* A second sheet behind, for depth. */}
      <div
        aria-hidden
        className="border-border bg-card absolute inset-x-6 -top-3 bottom-6 rotate-3 rounded-2xl border opacity-60"
      />

      <div
        aria-hidden
        className="border-border bg-card relative -rotate-1 rounded-2xl border p-6 shadow-xl shadow-black/5 sm:p-8 dark:shadow-black/40"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
            <FileText className="size-3.5" />
            APR-2026-0147 · Public Health
          </span>
          <span className="bg-mark/10 text-mark rounded-full px-2.5 py-1 text-[11px] font-semibold">
            In review
          </span>
        </div>

        <div className="font-heading text-foreground/90 mt-5 space-y-3 text-[15px] leading-relaxed">
          <p>
            Women who attended four or more antenatal visits had{" "}
            <span className="text-muted-foreground line-through decoration-1">much</span>{" "}
            <span className="text-mark">significantly</span> lower odds of low birth weight.
          </p>
          <p>
            <mark className="bg-mark/15 text-foreground rounded-sm px-0.5">
              Late first attendance, after twenty weeks, remained common.
            </mark>{" "}
            It was strongly associated with distance to the nearest facility.
          </p>
          <p className="text-muted-foreground">
            We discuss practical steps for community outreach that could move first visits earlier
            in pregnancy.
          </p>
        </div>
      </div>

      {/* The reviewer's note, pinned to the highlighted sentence. */}
      <div
        aria-hidden
        className="glass absolute -right-2 -bottom-8 w-60 rounded-xl p-4 sm:-right-8"
      >
        <p className="text-mark flex items-center gap-1.5 text-xs font-semibold">
          <MessageSquareText className="size-3.5" />
          Reviewer · Anonymous
        </p>
        <p className="mt-2 text-sm leading-snug">
          Your strongest finding. Say how distance was measured.
        </p>
      </div>
    </div>
  );
}

const RATINGS = [
  { label: "Reviewer 1", score: 5 },
  { label: "Reviewer 2", score: 4 },
];

/** The review a user gets back: criteria, a summary, and the marked-up file. */
export function ReviewSummaryVisual({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="An accepted paper showing two anonymous reviewers' scores, their comments, and a marked-up copy ready to download."
      className={cn("mx-auto w-full max-w-md", className)}
    >
      <div
        aria-hidden
        className="border-border bg-card rounded-2xl border p-6 shadow-xl shadow-black/5 sm:p-8 dark:shadow-black/40"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-heading text-lg font-medium">Your reviews</p>
          <span className="bg-success/10 text-success rounded-full px-2.5 py-1 text-[11px] font-semibold">
            Accepted
          </span>
        </div>

        <dl className="mt-6 space-y-3.5">
          {RATINGS.map((rating) => (
            <div key={rating.label} className="flex items-center justify-between gap-4">
              <dt className="text-sm">{rating.label}</dt>
              <dd className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((step) => (
                  <span
                    key={step}
                    className={cn(
                      "h-1.5 w-6 rounded-full",
                      step <= rating.score ? "bg-mark" : "bg-border",
                    )}
                  />
                ))}
              </dd>
            </div>
          ))}
        </dl>

        <p className="border-border text-muted-foreground mt-6 border-t pt-5 text-sm leading-relaxed">
          A clear and well-designed cohort study. Consider a sensitivity analysis excluding women
          who moved during pregnancy.
        </p>

        <div className="bg-muted mt-5 flex items-center justify-between gap-3 rounded-xl px-4 py-3">
          <span className="flex min-w-0 items-center gap-2.5 text-sm">
            <FileText className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate font-medium">APR-2026-0147-reviewed.pdf</span>
          </span>
          <Download className="text-mark size-4 shrink-0" />
        </div>
      </div>
    </div>
  );
}
