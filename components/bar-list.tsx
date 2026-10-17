/**
 * A ranked list of counts with a bar under each: "papers per topic", say.
 *
 * One measure, one colour (the accent), one shared scale, largest first. The
 * exact count is always written beside its label, so the bars are a guide to
 * proportion and never the only way to read a value — and the list itself is
 * the table view.
 */
export function BarList({
  items,
  label,
  empty = "Nothing to show yet.",
}: {
  items: Array<{ label: string; count: number }>;
  /** Accessible name for the list, e.g. "Papers by topic". */
  label: string;
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  const max = Math.max(...items.map((item) => item.count), 1);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium">{item.count}</span>
              <span className="text-muted-foreground">
                {" "}
                · {Math.round((item.count / total) * 100)}%
              </span>
            </span>
          </div>
          <div className="bg-border/60 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-mark h-full rounded-full"
              style={{ width: `${Math.max(2, (item.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
