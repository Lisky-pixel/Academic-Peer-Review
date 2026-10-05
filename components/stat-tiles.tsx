import Link from "next/link";
import { cn } from "@/lib/utils";

export type Stat = {
  label: string;
  value: number | string;
  /** Makes the tile a link, e.g. to the list filtered to what it counts. */
  href?: string;
  /** "attention" draws the eye when the number is something to act on. */
  tone?: "default" | "attention";
};

/**
 * A row of headline numbers. Each is a plain figure with a label — where a
 * single number is the whole story, a chart would only slow the reader down.
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
        const body = (
          <>
            <span className="text-muted-foreground block text-sm">{stat.label}</span>
            <span
              className={cn(
                "font-heading mt-1 block text-3xl font-medium tabular-nums",
                attention && "text-warning",
              )}
            >
              {stat.value}
            </span>
          </>
        );
        const box = "border-border bg-card block rounded-2xl border p-4 sm:p-5";

        return stat.href ? (
          <li key={stat.label}>
            <Link
              href={stat.href}
              className={cn(
                box,
                "hover:border-ring focus-visible:border-ring transition-colors outline-none",
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
