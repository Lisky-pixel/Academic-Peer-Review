import type { Tone } from "@/lib/submissions/stage";
import { cn } from "@/lib/utils";

const TONE: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  // Solid tints, mixed with the card colour, so the text keeps its contrast
  // whatever the pill sits on, including the blue backdrop.
  progress: "bg-[color-mix(in_srgb,var(--mark)_10%,var(--card))] text-mark",
  success: "bg-[color-mix(in_srgb,var(--success)_10%,var(--card))] text-success",
  muted: "bg-muted text-muted-foreground",
  warning: "bg-[color-mix(in_srgb,var(--warning)_12%,var(--card))] text-warning",
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
