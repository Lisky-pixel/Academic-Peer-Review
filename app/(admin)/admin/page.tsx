import type { Metadata } from "next";
import Link from "next/link";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { requireRole } from "@/lib/auth/guards";
import { toAdminSubmissionDTO } from "@/lib/dto/submission";
import { formatDate } from "@/lib/format";
import type { SubmissionStatus } from "@/lib/generated/prisma/client";
import { findSubmissionsForAdmin } from "@/lib/submissions";
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

export default async function AdminHomePage({ searchParams }: PageProps<"/admin">) {
  const user = await requireRole("ADMIN");

  const { view: requested } = await searchParams;
  const view: View =
    typeof requested === "string" && requested in VIEWS ? (requested as View) : "unassigned";
  const { statuses, empty } = VIEWS[view];

  const submissions = (await findSubmissionsForAdmin(statuses ? [...statuses] : undefined)).map(
    toAdminSubmissionDTO,
  );

  return (
    <RoleArea
      user={user}
      title="Submissions"
      description="Everything authors have submitted. Drafts stay private until they are submitted."
      current="/admin"
    >
      <div className="space-y-5">
        <nav aria-label="Filter submissions" className="flex gap-1.5 overflow-x-auto pb-1">
          {(Object.keys(VIEWS) as View[]).map((key) => (
            <Link
              key={key}
              href={key === "unassigned" ? "/admin" : `/admin?view=${key}`}
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

        {submissions.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            {empty}
          </p>
        ) : (
          <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-2xl border">
            {submissions.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6"
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
                  {submission.submittedAt && <p>Submitted {formatDate(submission.submittedAt)}</p>}
                  {submission.deadline && <p>Due {formatDate(submission.deadline)}</p>}
                </div>
                <StatusPill tone={STATUS_TONE[submission.status]}>
                  {STATUS_LABEL[submission.status]}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground text-sm">
          Assigning a reviewer is the next part of ReviewFlow to be built.
        </p>
      </div>
    </RoleArea>
  );
}
