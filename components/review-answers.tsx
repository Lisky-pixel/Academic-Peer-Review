import { cn } from "@/lib/utils";

/**
 * A finished review, read-only: each criterion with its score and comment.
 * Shared by the administrator's approval screen and the author's result, so
 * what the admin approves is exactly what the author then reads.
 */
export function ReviewAnswers({
  criteria,
  className,
}: {
  criteria: Array<{
    label: string;
    maxRating: number;
    rating: number | null;
    comment: string | null;
  }>;
  className?: string;
}) {
  return (
    <dl className={cn("border-border divide-border divide-y border-y", className)}>
      {criteria.map((criterion) => (
        <div key={criterion.label} className="space-y-2 py-5">
          <dt className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span className="font-medium">{criterion.label}</span>
            {criterion.rating !== null && (
              <span className="flex items-center gap-3">
                <span aria-hidden className="flex gap-1">
                  {Array.from({ length: criterion.maxRating }, (_, index) => (
                    <span
                      key={index}
                      className={cn(
                        "h-1.5 w-5 rounded-full",
                        index < criterion.rating! ? "bg-mark" : "bg-border",
                      )}
                    />
                  ))}
                </span>
                <span className="text-sm tabular-nums">
                  {criterion.rating} of {criterion.maxRating}
                </span>
              </span>
            )}
          </dt>
          {criterion.comment && (
            <dd className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
              {criterion.comment}
            </dd>
          )}
          {criterion.rating === null && !criterion.comment && (
            <dd className="text-muted-foreground text-sm">No answer</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
