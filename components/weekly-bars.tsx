import { cn } from "@/lib/utils";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** A round number at or above `max`, so the axis ends somewhere sensible. */
function niceCeiling(max: number): number {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= max) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * A bar chart of one count per week.
 *
 * One series, so one colour and no legend — the heading above it says what
 * is being counted. Bars start at zero. Each shows its exact figure on hover
 * or keyboard focus, and the same numbers are available as a table beneath,
 * so nothing depends on reading a height or seeing a colour.
 */
export function WeeklyBars({
  weeks,
  unit,
}: {
  weeks: Array<{ weekStart: string; count: number }>;
  /** What one unit is, singular: "submission". */
  unit: string;
}) {
  const top = niceCeiling(Math.max(...weeks.map((week) => week.count), 0));
  const ticks = [top, top / 2, 0];
  const plural = (count: number) => `${count} ${unit}${count === 1 ? "" : "s"}`;

  return (
    <figure className="space-y-4">
      <div className="flex gap-3">
        {/* Axis values: muted, and only three of them. */}
        <div
          aria-hidden
          className="text-muted-foreground flex h-48 flex-col justify-between text-right text-xs tabular-nums"
        >
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {tick}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-48">
            {/* Grid lines sit behind the bars and stay faint. */}
            <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
              {ticks.map((tick) => (
                <span key={tick} className="border-border border-t" />
              ))}
            </div>

            <ul className="relative flex h-full items-end gap-[2px] sm:gap-1.5">
              {weeks.map((week) => {
                const label = `Week of ${DAY.format(new Date(week.weekStart))}: ${plural(week.count)}`;
                return (
                  <li
                    key={week.weekStart}
                    tabIndex={0}
                    aria-label={label}
                    className="group focus-visible:ring-ring/40 relative flex h-full min-w-0 flex-1 items-end rounded-sm outline-none focus-visible:ring-3"
                  >
                    <span
                      className={cn(
                        "bg-mark group-hover:bg-mark/80 w-full rounded-t-[4px] transition-colors",
                        // A week with nothing still gets a sliver, so it reads
                        // as "zero" and not as missing data.
                        week.count === 0 && "bg-border group-hover:bg-border",
                      )}
                      style={{ height: week.count === 0 ? 2 : `${(week.count / top) * 100}%` }}
                    />
                    <span
                      role="tooltip"
                      className="bg-popover text-popover-foreground border-border pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md group-hover:block group-focus:block"
                    >
                      <span className="font-medium">{plural(week.count)}</span>
                      <span className="text-muted-foreground block">
                        Week of {DAY.format(new Date(week.weekStart))}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <ul aria-hidden className="mt-2 flex gap-[2px] sm:gap-1.5">
            {weeks.map((week, index) => (
              <li
                key={week.weekStart}
                className="text-muted-foreground min-w-0 flex-1 text-center text-[11px] whitespace-nowrap"
              >
                {/* Every third week is labelled; more would collide. */}
                {index % 3 === 0 ? DAY.format(new Date(week.weekStart)) : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
          Show as a table
        </summary>
        <table className="mt-3 w-full max-w-sm text-left">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="py-1.5 font-medium">
                Week starting
              </th>
              <th scope="col" className="py-1.5 text-right font-medium capitalize">
                {unit}s
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {weeks.map((week) => (
              <tr key={week.weekStart}>
                <td className="py-1.5">{DAY.format(new Date(week.weekStart))}</td>
                <td className="py-1.5 text-right tabular-nums">{week.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
