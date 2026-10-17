import {
  ChevronRight,
  CircleCheck,
  CircleX,
  Download,
  FileStack,
  Gavel,
  Hourglass,
  Settings,
  UserRoundSearch,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunMatchingForm } from "@/app/(organiser)/organiser/forms";
import { BackLink } from "@/components/back-link";
import { BarList } from "@/components/bar-list";
import { CONTROL } from "@/components/form";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { findConference, findConferencePapers, type PaperFilter } from "@/lib/conferences";
import { requireOrganiserOf } from "@/lib/conferences/guard";
import { findConferenceReport } from "@/lib/conferences/reports";
import { PHASE_LABEL, toConferenceDetailDTO, toPaperRowDTO } from "@/lib/dto/conference";
import { formatDate } from "@/lib/format";
import type { SubmissionStatus } from "@/lib/generated/prisma/client";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/submissions/stage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conference" };

const TABS = { papers: "Papers", reviewers: "Reviewers", reports: "Reports" } as const;
type Tab = keyof typeof TABS;

const STATUS_FILTERS: Array<{ value: PaperFilter["status"] | ""; label: string }> = [
  { value: "", label: "All papers" },
  { value: "needs_reviewers", label: "Needs reviewers" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "REVIEWS_COMPLETE", label: "Ready for decision" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];

const STATUSES = new Set(STATUS_FILTERS.map((filter) => filter.value).filter(Boolean));

export default async function ConferencePage({
  params,
  searchParams,
}: PageProps<"/organiser/conferences/[id]">) {
  const { id } = await params;
  const user = await requireOrganiserOf(id);
  const query = await searchParams;

  const tab: Tab =
    typeof query.tab === "string" && query.tab in TABS ? (query.tab as Tab) : "papers";
  const status =
    typeof query.status === "string" && STATUSES.has(query.status as SubmissionStatus)
      ? (query.status as PaperFilter["status"])
      : undefined;
  const topic = typeof query.topic === "string" ? query.topic : undefined;
  const search = typeof query.q === "string" ? query.q : undefined;

  const record = await findConference(id);
  if (!record) notFound();
  const conference = toConferenceDetailDTO(record);

  const [allPapers, papers, report] = await Promise.all([
    findConferencePapers(id),
    tab === "papers" ? findConferencePapers(id, { status, topic, query: search }) : [],
    tab === "papers" ? null : findConferenceReport(id),
  ]);
  const all = allPapers.map((paper) => toPaperRowDTO(paper));
  const rows = papers.map((paper) => toPaperRowDTO(paper));
  const count = (statuses: SubmissionStatus[]) =>
    all.filter((paper) => statuses.includes(paper.status)).length;
  const needsReviewers = all.filter(
    (paper) =>
      ["SUBMITTED", "UNDER_REVIEW"].includes(paper.status) &&
      paper.reviewers < conference.reviewersPerPaper,
  ).length;

  const base = `/organiser/conferences/${id}`;

  return (
    <RoleArea
      user={user}
      wide
      title={conference.name}
      eyebrow={
        <BackLink href={user.role === "ADMIN" ? "/admin" : "/organiser"}>Conferences</BackLink>
      }
      description={
        <>
          {PHASE_LABEL[conference.phase]} · call closes {formatDate(conference.closesAt)} · reviews
          due {formatDate(conference.reviewDeadline)} · {conference.reviewersPerPaper}{" "}
          {conference.reviewersPerPaper === 1 ? "reviewer" : "reviewers"} per paper ·{" "}
          {conference.doubleBlind ? "double-blind" : "authors visible to reviewers"}
        </>
      }
      actions={
        <>
          <Button asChild variant="outline" size="lg">
            <a href={`${base}/export/papers`}>
              <Download aria-hidden />
              Papers (Excel)
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href={`${base}/export/reviews`}>
              <Download aria-hidden />
              Reviews (Excel)
            </a>
          </Button>
          {user.role === "ADMIN" && (
            <Button asChild variant="ghost" size="lg">
              <Link href={`/admin/conferences/${id}`}>
                <Settings aria-hidden />
                Settings
              </Link>
            </Button>
          )}
        </>
      }
    >
      <StatTiles
        stats={[
          {
            label: "Submitted",
            icon: FileStack,
            value: all.filter((paper) => paper.status !== "WITHDRAWN").length,
            href: `${base}?tab=papers`,
          },
          {
            label: "Need reviewers",
            icon: UserRoundSearch,
            value: needsReviewers,
            href: `${base}?status=needs_reviewers`,
            tone: "attention",
          },
          {
            label: "Under review",
            icon: Hourglass,
            value: count(["UNDER_REVIEW"]),
            href: `${base}?status=UNDER_REVIEW`,
          },
          {
            label: "Ready for decision",
            icon: Gavel,
            value: count(["REVIEWS_COMPLETE"]),
            href: `${base}?status=REVIEWS_COMPLETE`,
            tone: "attention",
          },
          {
            label: "Accepted",
            icon: CircleCheck,
            value: count(["ACCEPTED"]),
            href: `${base}?status=ACCEPTED`,
          },
          {
            label: "Rejected",
            icon: CircleX,
            value: count(["REJECTED"]),
            href: `${base}?status=REJECTED`,
          },
        ]}
      />

      {(needsReviewers > 0 || count(["SUBMITTED"]) > 0) && (
        <section className="glass flex flex-wrap items-center justify-between gap-5 rounded-2xl p-5 sm:p-6">
          <div className="max-w-xl min-w-0 space-y-1">
            <h2 className="font-medium">Match reviewers</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Papers are matched automatically by discipline when the call closes on{" "}
              {formatDate(conference.closesAt)}. Matching now sends them to reviewers straight away,
              and submitters can no longer edit them.
            </p>
          </div>
          <RunMatchingForm conferenceId={id} />
        </section>
      )}

      <nav aria-label="Sections" className="flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <Link
            key={key}
            href={`${base}?tab=${key}`}
            aria-current={key === tab ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              key === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {TABS[key]}
          </Link>
        ))}
      </nav>

      {tab === "papers" && (
        <section aria-label="Papers" className="space-y-4">
          <form className="glass flex flex-wrap items-end gap-3 rounded-2xl p-4" role="search">
            <input type="hidden" name="tab" value="papers" />
            <label className="min-w-0 flex-1 basis-52 space-y-1.5 text-sm">
              <span className="font-medium">Search</span>
              <input
                name="q"
                defaultValue={search}
                placeholder="Title, reference or author"
                className={`${CONTROL} h-10`}
              />
            </label>
            <label className="min-w-0 basis-44 space-y-1.5 text-sm">
              <span className="font-medium">Status</span>
              <select name="status" defaultValue={status ?? ""} className={`${CONTROL} h-10`}>
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.label} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 basis-44 space-y-1.5 text-sm">
              <span className="font-medium">Topic</span>
              <select name="topic" defaultValue={topic ?? ""} className={`${CONTROL} h-10`}>
                <option value="">All topics</option>
                {conference.topics.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" size="lg" className="h-10">
              Filter
            </Button>
          </form>

          {rows.length === 0 ? (
            <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
              {all.length === 0 ? "No papers have been submitted yet." : "No papers match."}
            </p>
          ) : (
            <ul className="glass divide-border divide-y overflow-hidden rounded-2xl">
              {rows.map((paper) => (
                <li key={paper.id}>
                  <Link
                    href={`${base}/papers/${paper.id}`}
                    className="hover:bg-muted/60 focus-visible:bg-muted/60 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 transition-colors outline-none sm:px-6"
                  >
                    <span className="min-w-0 flex-1 basis-72 space-y-1">
                      <span className="block truncate font-medium">{paper.title}</span>
                      <span className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                        <span className="font-mono text-xs leading-5">{paper.reference}</span>
                        <span className="truncate">{paper.authorNames}</span>
                        <span>{paper.topic}</span>
                      </span>
                    </span>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {paper.reviewsIn}/{Math.max(paper.reviewers, conference.reviewersPerPaper)}{" "}
                      reviews
                      {paper.averageScore !== null && <> · avg {paper.averageScore}</>}
                      {paper.overdue > 0 && (
                        <span className="text-warning font-medium"> · {paper.overdue} overdue</span>
                      )}
                    </span>
                    <StatusPill tone={STATUS_TONE[paper.status]}>
                      {STATUS_LABEL[paper.status]}
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
        </section>
      )}

      {tab === "reviewers" && report && (
        <section aria-label="Reviewer progress" className="space-y-4">
          {report.reviewers.length === 0 ? (
            <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
              No reviewers have been assigned yet.
            </p>
          ) : (
            <div className="glass overflow-x-auto rounded-2xl">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Each reviewer’s progress in this conference</caption>
                <thead>
                  <tr className="text-muted-foreground border-border border-b text-left">
                    <th scope="col" className="px-5 py-3 font-medium">
                      Reviewer
                    </th>
                    {["Assigned", "Submitted", "Open", "Overdue", "Declined"].map((heading) => (
                      <th key={heading} scope="col" className="px-4 py-3 text-right font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {report.reviewers.map((reviewer) => (
                    <tr key={reviewer.reviewerId}>
                      <th scope="row" className="px-5 py-3 text-left font-medium">
                        {reviewer.name}
                      </th>
                      <td className="px-4 py-3 text-right tabular-nums">{reviewer.assigned}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{reviewer.completed}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{reviewer.open}</td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right tabular-nums",
                          reviewer.overdue > 0 && "text-warning font-medium",
                        )}
                      >
                        {reviewer.overdue}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{reviewer.declined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "reports" && report && (
        <section aria-label="Reports" className="space-y-6">
          <StatTiles
            stats={[
              { label: "Papers submitted", value: report.summary.submitted },
              { label: "Decided", value: report.summary.decided },
              {
                label: "Acceptance rate",
                value:
                  report.summary.acceptanceRate === null
                    ? "—"
                    : `${report.summary.acceptanceRate}%`,
              },
              {
                label: "Average score (of 5)",
                value: report.summary.averageScore ?? "—",
              },
            ]}
          />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            <ReportCard title="Papers by topic">
              <BarList label="Papers by topic" items={report.summary.byTopic} />
            </ReportCard>
            <ReportCard title="Papers by discipline">
              <BarList label="Papers by discipline" items={report.summary.byDiscipline} />
            </ReportCard>
            <ReportCard title="Papers by type">
              <BarList label="Papers by type" items={report.summary.byType} />
            </ReportCard>
            <ReportCard title="Papers by status">
              <BarList label="Papers by status" items={report.summary.byStatus} />
            </ReportCard>
          </div>
        </section>
      )}
    </RoleArea>
  );
}

function ReportCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass space-y-5 rounded-2xl p-5 sm:p-6">
      <h2 className="font-heading text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}
