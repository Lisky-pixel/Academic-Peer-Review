import type { Metadata } from "next";
import Link from "next/link";
import { RoleArea } from "@/components/role-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  ACTIVITY_PAGE_SIZE,
  findActivity,
} from "@/lib/admin/activity";
import { requireRole } from "@/lib/auth/guards";
import { toActivityEntryDTO } from "@/lib/dto/admin";

export const metadata: Metadata = { title: "Activity" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const SELECT =
  "border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 h-9 min-w-0 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3";

/** "YYYY-MM-DD" from a date input → midnight UTC that day, or undefined. */
function parseDay(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const user = await requireRole("ADMIN");

  const params = await searchParams;
  const category =
    typeof params.category === "string" && params.category in ACTIVITY_CATEGORIES
      ? (params.category as ActivityCategory)
      : undefined;
  const from = parseDay(params.from);
  const to = parseDay(params.to);
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const filtered = Boolean(category || from || to);

  const { items, total, page, pages } = await findActivity({
    category,
    from,
    to,
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
  });
  const entries = items.map(toActivityEntryDTO);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (category) query.set("category", category);
    if (typeof params.from === "string" && from) query.set("from", params.from);
    if (typeof params.to === "string" && to) query.set("to", params.to);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/admin/activity?${text}` : "/admin/activity";
  };

  return (
    <RoleArea
      user={user}
      title="Activity"
      description="Everything that has happened, who did it, and when. Entries are never edited or removed. Times are in UTC."
      current="/admin/activity"
    >
      <div className="space-y-5">
        <form method="get" action="/admin/activity" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="category">Kind</Label>
            <select id="category" name="category" defaultValue={category ?? ""} className={SELECT}>
              <option value="">Everything</option>
              {Object.entries(ACTIVITY_CATEGORIES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              name="from"
              type="date"
              defaultValue={from ? String(params.from) : ""}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              name="to"
              type="date"
              defaultValue={to ? String(params.to) : ""}
              className="h-9"
            />
          </div>
          <Button type="submit" variant="outline" size="lg">
            Filter
          </Button>
          {filtered && (
            <Button asChild variant="ghost" size="lg">
              <Link href="/admin/activity">Clear</Link>
            </Button>
          )}
        </form>

        <p className="text-muted-foreground text-sm tabular-nums">
          {total === 0
            ? "No entries"
            : `${(page - 1) * ACTIVITY_PAGE_SIZE + 1}–${Math.min(page * ACTIVITY_PAGE_SIZE, total)} of ${total} entries`}
        </p>

        {entries.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            Nothing matches those filters.
          </p>
        ) : (
          <div className="glass overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    What
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    About
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Who
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {entries.map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="text-muted-foreground px-5 py-3 whitespace-nowrap tabular-nums">
                      {dateTime.format(new Date(entry.at))}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-medium">{entry.label}</span>
                      {entry.detail && (
                        <span className="text-muted-foreground mt-0.5 block">{entry.detail}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {entry.subject === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : entry.href ? (
                        <Link
                          href={entry.href}
                          className="text-mark underline-offset-4 hover:underline"
                        >
                          {entry.subject}
                        </Link>
                      ) : (
                        entry.subject
                      )}
                    </td>
                    <td className="text-muted-foreground px-5 py-3">{entry.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-4">
            {page > 1 ? (
              <Button asChild variant="outline" size="lg">
                <Link href={pageHref(page - 1)}>Newer</Link>
              </Button>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground text-sm tabular-nums">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Button asChild variant="outline" size="lg">
                <Link href={pageHref(page + 1)}>Older</Link>
              </Button>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </RoleArea>
  );
}
