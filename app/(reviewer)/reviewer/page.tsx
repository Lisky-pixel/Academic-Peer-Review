import { ChevronRight, CircleCheck, Clock, Inbox, PenLine, UserRoundPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { hasReviewerProfile } from "@/lib/conferences/pool";
import { type ReviewerQueueItemDTO, toReviewerQueueItemDTO } from "@/lib/dto/review";
import { formatDate } from "@/lib/format";
import { findReviewerQueue } from "@/lib/reviews";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reviews" };

const TABS = {
  pending: {
    label: "To answer",
    empty: "No new assignments are waiting for your answer.",
    match: (item: ReviewerQueueItemDTO) => item.bucket === "pending",
  },
  active: {
    label: "In progress",
    empty: "You have no reviews in progress.",
    match: (item: ReviewerQueueItemDTO) => item.bucket === "active",
  },
  overdue: {
    label: "Overdue",
    empty: "Nothing is overdue.",
    match: (item: ReviewerQueueItemDTO) => item.overdue,
  },
  completed: {
    label: "Submitted",
    empty: "You have not submitted any reviews yet.",
    match: (item: ReviewerQueueItemDTO) => item.bucket === "completed",
  },
} as const;

type Tab = keyof typeof TABS;

function statusOf(item: ReviewerQueueItemDTO): {
  label: string;
  tone: "progress" | "success" | "muted";
} {
  if (item.bucket === "completed") return { label: "Submitted", tone: "success" };
  if (item.closed) return { label: "No longer needed", tone: "muted" };
  return {
    label: item.bucket === "pending" ? "Needs your answer" : "In progress",
    tone: "progress",
  };
}

export default async function ReviewerHomePage({ searchParams }: PageProps<"/reviewer">) {
  const user = await requireRole("REVIEWER");

  const [records, profile] = await Promise.all([
    findReviewerQueue(user.id),
    hasReviewerProfile(user.id),
  ]);
  const items = records.map((record) => toReviewerQueueItemDTO(record));

  const { tab: requested } = await searchParams;
  // Open on whatever needs attention first.
  const fallback: Tab = items.some(TABS.pending.match)
    ? "pending"
    : items.some(TABS.active.match) || !items.some(TABS.completed.match)
      ? "active"
      : "completed";
  const tab: Tab =
    typeof requested === "string" && requested in TABS ? (requested as Tab) : fallback;
  const shown = items.filter(TABS[tab].match);

  return (
    <RoleArea
      user={user}
      title="Reviews"
      description="Papers matched to you. Authors never learn who reviewed their work."
      current="/reviewer"
    >
      {!profile && (
        <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5 sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="bg-warning/15 text-warning flex size-10 shrink-0 items-center justify-center rounded-xl">
              <UserRoundPen aria-hidden className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-medium">Complete your reviewer profile</p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Papers are matched to you by discipline. Until you choose yours, you will not be
                sent any.
              </p>
            </div>
          </div>
          <Button asChild size="lg">
            <a href="/profile#reviewer">Complete profile</a>
          </Button>
        </div>
      )}
      <StatTiles
        stats={[
          {
            label: "To answer",
            icon: Inbox,
            value: items.filter(TABS.pending.match).length,
            href: "/reviewer?tab=pending",
            tone: "attention",
          },
          {
            label: "In progress",
            icon: PenLine,
            value: items.filter(TABS.active.match).length,
            href: "/reviewer?tab=active",
          },
          {
            label: "Overdue",
            icon: Clock,
            value: items.filter(TABS.overdue.match).length,
            href: "/reviewer?tab=overdue",
            tone: "attention",
          },
          {
            label: "Submitted",
            icon: CircleCheck,
            value: items.filter(TABS.completed.match).length,
            href: "/reviewer?tab=completed",
          },
        ]}
      />

      <div className="space-y-5">
        <nav aria-label="Filter your queue" className="flex gap-1.5 overflow-x-auto pb-1">
          {(Object.keys(TABS) as Tab[]).map((key) => {
            const count = items.filter(TABS[key].match).length;
            return (
              <Link
                key={key}
                href={`/reviewer?tab=${key}`}
                aria-current={key === tab ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                  key === tab
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {TABS[key].label}
                {count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      key === tab ? "bg-primary-foreground/20" : "bg-muted",
                      key === "overdue" && key !== tab && "bg-warning/15 text-warning",
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {shown.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            {TABS[tab].empty}
          </p>
        ) : (
          <ul className="glass divide-border divide-y overflow-hidden rounded-2xl">
            {shown.map((item) => {
              const status = statusOf(item);
              return (
                <li key={item.submissionId}>
                  <Link
                    href={`/reviewer/reviews/${item.submissionId}`}
                    className="hover:bg-muted/60 focus-visible:bg-muted/60 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 transition-colors outline-none sm:px-6"
                  >
                    <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                      <p className="truncate font-medium">{item.title}</p>
                      <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                        <span className="font-mono text-xs leading-5">{item.reference}</span>
                        <span>{item.topic}</span>
                        <span className="truncate">{item.conferenceName}</span>
                      </p>
                    </div>
                    {item.bucket !== "completed" && !item.closed && (
                      <p
                        className={cn(
                          "text-sm",
                          item.overdue ? "text-warning font-medium" : "text-muted-foreground",
                        )}
                      >
                        {item.overdue ? "Overdue since" : "Due"} {formatDate(item.dueAt)}
                      </p>
                    )}
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                    <ChevronRight
                      aria-hidden
                      className="text-muted-foreground hidden size-4 sm:block"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </RoleArea>
  );
}
