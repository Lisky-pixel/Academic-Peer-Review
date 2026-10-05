import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type Stat = {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  /** Makes the tile a link, e.g. to the list filtered to what it counts. */
  href?: string;
  /** "attention" draws the eye when the number is something to act on. */
  tone?: "default" | "attention";
};

/**
 * A row of headline numbers on frosted tiles. Each is a plain figure with a
 * label — where a single number is the whole story, a chart would only slow
 * the reader down.
 */
export function StatTiles({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3",
        stats.length >= 6 ? "lg:grid-cols-6" : "lg:grid-cols-4",
        className,
      )}
    >
      {stats.map((stat) => {
        const attention = stat.tone === "attention" && stat.value !== 0;
        const Icon = stat.icon;
        const body = (
          <>
            {Icon && (
              <span
                className={cn(
                  "mb-4 flex size-9 items-center justify-center rounded-xl",
                  attention ? "bg-warning/15 text-warning" : "bg-mark/10 text-mark",
                )}
              >
                <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
              </span>
            )}
            <span className="font-heading block text-3xl leading-none font-medium tabular-nums sm:text-4xl">
              {stat.value}
            </span>
            <span className="text-muted-foreground mt-2 block text-sm leading-snug">
              {stat.label}
            </span>
          </>
        );
        const box = "glass block h-full rounded-2xl p-4 sm:p-5";

        return stat.href ? (
          <li key={stat.label}>
            <Link
              href={stat.href}
              className={cn(
                box,
                "focus-visible:ring-ring/40 transition-transform duration-200 outline-none hover:-translate-y-0.5 focus-visible:ring-3 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              )}
            >
              {body}
            </Link>
          </li>
        ) : (
          <li key={stat.label} className={box}>
            {body}
          </li>
        );
      })}
    </ul>
  );
}
