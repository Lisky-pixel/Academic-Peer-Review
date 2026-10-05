import { Download, Eye, EyeOff, FileText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setAuthorVisibilityAction } from "@/app/(admin)/admin/submissions/[id]/actions";
import { AssignForm } from "@/app/(admin)/admin/submissions/[id]/assign-form";
import { BackLink } from "@/components/back-link";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  findReviewersWithWorkload,
  findSubmissionActivity,
  findSubmissionForAdmin,
} from "@/lib/assignments";
import { requireRole } from "@/lib/auth/guards";
import {
  type AdminSubmissionDetailDTO,
  type AssignmentDTO,
  toActivityDTO,
  toAdminSubmissionDetailDTO,
  toReviewerOptionDTO,
} from "@/lib/dto/assignment";
import { formatBytes } from "@/lib/files/validate";
import { formatDate, isUuid } from "@/lib/format";
import { deadlineInputValue, earliestDeadlineInput } from "@/lib/submissions/schema";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/submissions/stage";

export const metadata: Metadata = { title: "Submission" };

const ASSIGNMENT_LABEL: Record<AssignmentDTO["status"], string> = {
  PENDING: "Waiting for the reviewer to accept",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CANCELLED: "Withdrawn",
  COMPLETED: "Completed",
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export default async function AdminSubmissionPage({
  params,
}: PageProps<"/admin/submissions/[id]">) {
  const user = await requireRole("ADMIN");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const record = await findSubmissionForAdmin(id);
  if (!record) notFound();
  const submission = toAdminSubmissionDetailDTO(record);

  const [reviewers, activity] = await Promise.all([
    submission.canAssign || submission.canReassign
      ? findReviewersWithWorkload().then((list) => list.map(toReviewerOptionDTO))
      : [],
    findSubmissionActivity(id).then((list) => list.map(toActivityDTO)),
  ]);

  return (
    <RoleArea
      user={user}
      eyebrow={<BackLink href="/admin">Submissions</BackLink>}
      title={submission.title}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="tabular-nums">{submission.reference}</span>
          <span>{submission.documentType.name}</span>
          <StatusPill tone={STATUS_TONE[submission.status]}>
            {STATUS_LABEL[submission.status]}
          </StatusPill>
        </span>
      }
      current="/admin"
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-10">
          <Section title={submission.canReassign ? "Reviewer" : "Assign a reviewer"}>
            <ReviewerPanel submission={submission} reviewers={reviewers} />
          </Section>

          <Section title="What the author asked for">
            <Brief submission={submission} />
          </Section>
        </div>

        <div className="space-y-10">
          <Section title="Author">
            <p className="text-sm font-medium">{submission.author.name}</p>
            <p className="text-muted-foreground text-sm">{submission.author.email}</p>
            <VisibilityControl submission={submission} />
          </Section>

          {submission.document && (
            <Section title="Document">
              <div className="border-border bg-card flex items-center justify-between gap-3 rounded-xl border p-4">
                <span className="flex min-w-0 items-center gap-3">
                  <FileText aria-hidden className="text-mark size-5 shrink-0" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {submission.document.filename}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {formatBytes(submission.document.sizeBytes)}
                    </span>
                  </span>
                </span>
                <Button asChild variant="outline" size="icon-lg" aria-label="Download the document">
                  <a href={`/admin/submissions/${submission.id}/document`}>
                    <Download aria-hidden />
                  </a>
                </Button>
              </div>
            </Section>
          )}

          <Section title="Activity">
            <ol className="space-y-4">
              {activity.map((entry) => (
                <li key={entry.id} className="border-border border-l pl-4">
                  <p className="text-sm font-medium">{entry.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {entry.actor} · {dateTime.format(new Date(entry.at))}
                  </p>
                  {entry.detail && (
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {entry.detail}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </RoleArea>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl font-medium">{title}</h2>
      {children}
    </section>
  );
}

function ReviewerPanel({
  submission,
  reviewers,
}: {
  submission: AdminSubmissionDetailDTO;
  reviewers: Parameters<typeof AssignForm>[0]["reviewers"];
}) {
  const current = submission.assignment;
  const past = submission.history.filter((assignment) => !assignment.isCurrent);
  const formProps = {
    submissionId: submission.id,
    reviewers,
    minDueAt: earliestDeadlineInput(),
  };

  return (
    <div className="space-y-6">
      {current && (
        <div className="border-border bg-card space-y-1 rounded-xl border p-5">
          <p className="font-medium">{current.reviewer.name}</p>
          <p className="text-muted-foreground text-sm">{current.reviewer.email}</p>
          <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 pt-2 text-sm">
            <span>{ASSIGNMENT_LABEL[current.status]}</span>
            <span>Assigned {formatDate(current.assignedAt)}</span>
            {current.dueAt && (
              <span className={current.overdue ? "text-warning font-medium" : undefined}>
                {current.overdue ? "Overdue since" : "Due"} {formatDate(current.dueAt)}
              </span>
            )}
          </p>
        </div>
      )}

      {submission.canAssign && (
        <AssignForm {...formProps} defaultDueAt={deadlineInputValue(submission.deadline)} />
      )}

      {submission.canReassign && current && (
        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-sm underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            Reassign to someone else
          </summary>
          <div className="pt-5">
            <AssignForm
              {...formProps}
              currentReviewerId={current.reviewer.id}
              defaultDueAt={deadlineInputValue(current.dueAt)}
            />
          </div>
        </details>
      )}

      {!current && !submission.canAssign && (
        <p className="text-muted-foreground text-sm">No reviewer holds this submission.</p>
      )}

      {past.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Previously with</h3>
          <ul className="border-border divide-border divide-y border-y text-sm">
            {past.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"
              >
                <span>{assignment.reviewer.name}</span>
                <span className="text-muted-foreground">
                  {ASSIGNMENT_LABEL[assignment.status]}
                  {assignment.endedAt && ` ${formatDate(assignment.endedAt)}`}
                </span>
                {assignment.declineReason && (
                  <span className="text-muted-foreground basis-full">
                    {assignment.declineReason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function VisibilityControl({ submission }: { submission: AdminSubmissionDetailDTO }) {
  const visible = submission.authorVisibleToReviewer;
  const Icon = visible ? Eye : EyeOff;

  return (
    <div className="border-border mt-4 space-y-3 border-t pt-4">
      <p className="flex items-start gap-2.5 text-sm leading-relaxed">
        <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span>
          {visible
            ? "The reviewer can see who wrote this."
            : "The author is hidden from the reviewer."}{" "}
          <span className="text-muted-foreground">The author never sees who the reviewer is.</span>
        </span>
      </p>
      {submission.canChangeVisibility && (
        <form action={setAuthorVisibilityAction}>
          <input type="hidden" name="submissionId" value={submission.id} />
          <input type="hidden" name="visible" value={String(!visible)} />
          <Button type="submit" variant="outline" size="lg">
            {visible ? "Hide the author from the reviewer" : "Show the author to the reviewer"}
          </Button>
        </form>
      )}
    </div>
  );
}

function Brief({ submission }: { submission: AdminSubmissionDetailDTO }) {
  const rows: Array<[string, string | null]> = [
    ["What it is for", submission.purpose],
    ["Instructions", submission.instructions],
    ["Where to focus", submission.focusAreas],
    ["Anything else", submission.description],
    ["Needed back by", submission.deadline ? formatDate(submission.deadline) : null],
    ["Submitted", submission.submittedAt ? formatDate(submission.submittedAt) : null],
  ];

  return (
    <dl className="border-border divide-border divide-y border-y">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="text-sm leading-relaxed whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
