import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** What each point on the 1–5 scale means. Shown to reviewers and in reviews. */
export const SCORE_LABEL: Record<number, string> = {
  1: "Poor",
  2: "Weak",
  3: "Fair",
  4: "Good",
  5: "Excellent",
};

/**
 * A score out of five: the number and its word, with five short bars beside
 * them. The number is always written, so the bars are decoration, never the
 * only carrier of the value.
 */
export function ScoreMeter({ score, className }: { score: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden className="flex gap-1">
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={cn("h-1.5 w-5 rounded-full", step <= score ? "bg-mark" : "bg-border")}
          />
        ))}
      </span>
      <span className="text-sm font-medium tabular-nums">
        {score}/5 <span className="text-muted-foreground font-normal">{SCORE_LABEL[score]}</span>
      </span>
    </span>
  );
}

/** "Recommended" or "Not recommended", with an icon so colour is never the only cue. */
export function Recommendation({ recommend }: { recommend: boolean }) {
  return recommend ? (
    <span className="bg-success/10 text-success inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
      <ThumbsUp aria-hidden className="size-3.5" />
      Recommended
    </span>
  ) : (
    <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
      <ThumbsDown aria-hidden className="size-3.5" />
      Not recommended
    </span>
  );
}
