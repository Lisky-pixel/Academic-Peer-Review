import type { Tone } from "@/lib/submissions/stage";
import { cn } from "@/lib/utils";

const TONE: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  progress: "bg-mark/10 text-mark",
  success: "bg-success/10 text-success",
  muted: "bg-muted text-muted-foreground",
};

/** A small coloured label for where something stands. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
