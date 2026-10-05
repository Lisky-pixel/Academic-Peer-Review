import {
  CircleCheck,
  ClipboardCheck,
  ChevronRight,
  Clock,
  Inbox,
  PackageOpen,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { findAdminCounts } from "@/lib/admin/reports";
import { requireRole } from "@/lib/auth/guards";
import { toAdminSubmissionDTO } from "@/lib/dto/submission";
import { formatDate, isUuid } from "@/lib/format";
import type { SubmissionStatus } from "@/lib/generated/prisma/client";
import { findDocumentTypes, findSubmissionsForAdmin } from "@/lib/submissions";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/submissions/stage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Submissions" };

const VIEWS = {
  unassigned: {
    label: "Needs a reviewer",
    statuses: ["PENDING_ASSIGNMENT"],
    empty: "Nothing is waiting for a reviewer.",
  },
  active: {
    label: "With reviewers",
    statuses: ["ASSIGNED", "ACCEPTED", "IN_REVIEW", "REVISION_REQUESTED"],
    empty: "No reviews are in progress.",
  },
  approval: {
    label: "Needs approval",
    statuses: ["UNDER_ADMIN_REVIEW"],
    empty: "No reviews are waiting for approval.",
  },
  all: { label: "All", statuses: undefined, empty: "Nothing has been submitted yet." },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly SubmissionStatus[] | undefined; empty: string }
>;

type View = keyof typeof VIEWS;

const DUE_OPTIONS = [
  { value: "", label: "Any deadline" },
  { value: "week", label: "Due within 7 days" },
  { value: "overdue", label: "Past its deadline" },
] as const;

const SELECT =
  "border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 h-9 min-w-0 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3";

/** Builds a link to this page that keeps the other filters as they are. */
function hrefFor(view: View, type: string, due: string): string {
  const query = new URLSearchParams();
  if (view !== "unassigned") query.set("view", view);
  if (type) query.set("type", type);
  if (due) query.set("due", due);
  const text = query.toString();
  return text ? `/admin?${text}` : "/admin";
}

export default async function AdminHomePage({ searchParams }: PageProps<"/admin">) {
  const user = await requireRole("ADMIN");

  const query = await searchParams;
  const view: View =
    typeof query.view === "string" && query.view in VIEWS ? (query.view as View) : "unassigned";
  const type = typeof query.type === "string" && isUuid(query.type) ? query.type : "";
  const due = query.due === "week" || query.due === "overdue" ? query.due : "";
  const { statuses, empty } = VIEWS[view];
  const filtered = Boolean(type || due);

  const [counts, records, documentTypes] = await Promise.all([
    findAdminCounts(),
    findSubmissionsForAdmin(statuses ? [...statuses] : undefined, {
      documentTypeId: type || undefined,
      due: due || undefined,
    }),
    findDocumentTypes(),
  ]);
  const submissions = records.map(toAdminSubmissionDTO);

  return (
    <RoleArea
      user={user}
      title="Submissions"
      description="Everything authors have submitted. Drafts stay private until they are submitted."
      current="/admin"
    >
      <StatTiles
        stats={[
          {
            label: "Need a reviewer",
            icon: Inbox,
            value: counts.needsReviewer,
            href: "/admin",
            tone: "attention",
          },
          {
            label: "With reviewers",
            icon: Users,
            value: counts.withReviewers,
            href: "/admin?view=active",
          },
          {
            label: "Need approval",
            icon: ClipboardCheck,
            value: counts.needsApproval,
            href: "/admin?view=approval",
            tone: "attention",
          },
          {
            label: "Overdue reviews",
            icon: Clock,
            value: counts.overdueReviews,
            tone: "attention",
          },
          { label: "Not yet collected", icon: PackageOpen, value: counts.awaitingCollection },
          { label: "Delivered", icon: CircleCheck, value: counts.delivered },
        ]}
      />

      <div className="space-y-5">
        <nav aria-label="Filter by status" className="flex gap-1.5 overflow-x-auto pb-1">
          {(Object.keys(VIEWS) as View[]).map((key) => (
            <Link
              key={key}
              href={hrefFor(key, type, due)}
              aria-current={key === view ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                key === view
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {VIEWS[key].label}
            </Link>
          ))}
        </nav>

        {/* A plain GET form: the filters live in the URL, so a filtered view
            can be bookmarked or sent to someone, and works without script. */}
        <form method="get" action="/admin" className="flex flex-wrap items-center gap-2">
          {view !== "unassigned" && <input type="hidden" name="view" value={view} />}
          <select name="type" defaultValue={type} aria-label="Document type" className={SELECT}>
            <option value="">Any type</option>
            {documentTypes.map((documentType) => (
              <option key={documentType.id} value={documentType.id}>
                {documentType.name}
              </option>
            ))}
          </select>
          <select name="due" defaultValue={due} aria-label="Deadline" className={SELECT}>
            {DUE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="lg">
            Filter
          </Button>
          {filtered && (
            <Button asChild variant="ghost" size="lg">
              <Link href={hrefFor(view, "", "")}>Clear</Link>
            </Button>
          )}
        </form>

        {submissions.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            {filtered ? "Nothing matches those filters." : empty}
          </p>
        ) : (
          <ul className="glass divide-border divide-y overflow-hidden rounded-2xl">
            {submissions.map((submission) => (
              <li key={submission.id}>
                <Link
                  href={`/admin/submissions/${submission.id}`}
                  className="hover:bg-muted/60 focus-visible:bg-muted/60 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 transition-colors outline-none sm:px-6"
                >
                  <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                    <p className="truncate font-medium">{submission.title}</p>
                    <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                      <span className="tabular-nums">{submission.reference}</span>
                      <span>{submission.documentType.name}</span>
                      <span>by {submission.author.name}</span>
                    </p>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {submission.reviewerName && <p>With {submission.reviewerName}</p>}
                    {submission.deadline ? (
                      <p>Due {formatDate(submission.deadline)}</p>
                    ) : (
                      submission.submittedAt && (
                        <p>Submitted {formatDate(submission.submittedAt)}</p>
                      )
                    )}
                  </div>
                  <StatusPill tone={STATUS_TONE[submission.status]}>
                    {STATUS_LABEL[submission.status]}
                  </StatusPill>
                  <ChevronRight
                    aria-hidden
                    className="text-muted-foreground hidden size-4 sm:block"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </RoleArea>
  );
}
