import { Check, Download, FileText, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitPanel, WithdrawPanel } from "@/app/(user)/dashboard/submissions/[id]/submit-panel";
import { BackLink } from "@/components/back-link";
import { DocumentUploader } from "@/app/(user)/dashboard/submissions/document-uploader";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { toUserSubmissionDTO, type UserSubmissionDTO } from "@/lib/dto/submission";
import { env } from "@/lib/env";
import { formatBytes } from "@/lib/files/validate";
import { formatDate, isUuid } from "@/lib/format";
import { findOwnSubmission } from "@/lib/submissions";
import { PROGRESS_STEPS, progressOf, STAGE_LABEL, STAGE_TONE } from "@/lib/submissions/stage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Submission" };

export default async function SubmissionPage({ params }: PageProps<"/dashboard/submissions/[id]">) {
  const user = await requireRole("USER");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Scoped to the author, so someone else's id is simply not found.
  const record = await findOwnSubmission(user.id, id);
  if (!record) notFound();
  const submission = toUserSubmissionDTO(record);

  return (
    <RoleArea
      user={user}
      eyebrow={<BackLink href="/dashboard">Your submissions</BackLink>}
      title={submission.title}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="tabular-nums">{submission.reference}</span>
          <span>{submission.documentType.name}</span>
          <StatusPill tone={STAGE_TONE[submission.stage]}>
            {STAGE_LABEL[submission.stage]}
          </StatusPill>
        </span>
      }
      current="/dashboard"
    >
      {submission.canEdit ? (
        <DraftView submission={submission} />
      ) : (
        <Progress submission={submission} />
      )}

      <Details submission={submission} />

      {!submission.canEdit && submission.document && (
        <Panel title="Your document">
          <DocumentRow submission={submission} />
        </Panel>
      )}

      {submission.canWithdraw && (
        <WithdrawPanel submissionId={submission.id} isDraft={submission.canEdit} />
      )}
    </RoleArea>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A draft: attach the document, then submit. */
function DraftView({ submission }: { submission: UserSubmissionDTO }) {
  return (
    <>
      <Panel title="Your document">
        <DocumentUploader
          submissionId={submission.id}
          document={submission.document}
          maxBytes={env.MAX_UPLOAD_BYTES}
        />
      </Panel>
      <SubmitPanel submissionId={submission.id} canSubmit={submission.canSubmit} />
    </>
  );
}

/** Where a submitted document is on its way to being reviewed. */
function Progress({ submission }: { submission: UserSubmissionDTO }) {
  if (submission.stage === "cancelled") {
    return (
      <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-8 text-center text-sm">
        This submission was cancelled and will not be reviewed.
      </p>
    );
  }

  const reached = progressOf(submission.stage);

  return (
    <section aria-label="Progress" className="border-border bg-card rounded-2xl border p-6 sm:p-8">
      <ol className="grid gap-5 sm:grid-cols-5 sm:gap-3">
        {PROGRESS_STEPS.map((step, index) => {
          const done = index + 1 < reached || submission.stage === "completed";
          const current = index + 1 === reached && !done;
          return (
            <li
              key={step.stage}
              aria-current={current ? "step" : undefined}
              className="flex items-center gap-3 sm:block"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done && "bg-mark text-background",
                  current && "bg-mark/15 text-mark ring-mark ring-2",
                  !done && !current && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check aria-hidden className="size-4" /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm sm:mt-3 sm:block",
                  done || current ? "font-medium" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      {submission.submittedAt && (
        <p className="text-muted-foreground border-border mt-6 border-t pt-5 text-sm">
          Submitted {formatDate(submission.submittedAt)}. We will let you know as it moves along.
          Your reviewer stays anonymous throughout.
        </p>
      )}
    </section>
  );
}

function Details({ submission }: { submission: UserSubmissionDTO }) {
  const rows: Array<[string, string | null]> = [
    ["What it is for", submission.purpose],
    ["Instructions", submission.instructions],
    ["Where to focus", submission.focusAreas],
    ["Anything else", submission.description],
    ["Needed back by", submission.deadline ? formatDate(submission.deadline) : null],
  ];
  const filled = rows.filter(([, value]) => value);

  return (
    <Panel
      title="Details"
      action={
        submission.canEdit && (
          <Button asChild variant="outline" size="lg">
            <Link href={`/dashboard/submissions/${submission.id}/edit`}>
              <Pencil aria-hidden />
              Edit
            </Link>
          </Button>
        )
      }
    >
      {filled.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No instructions or deadline were given for this document.
        </p>
      ) : (
        <dl className="border-border divide-border divide-y border-y">
          {filled.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6"
            >
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="text-sm leading-relaxed whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function DocumentRow({ submission }: { submission: UserSubmissionDTO }) {
  if (!submission.document) return null;
  return (
    <div className="border-border bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
      <span className="flex min-w-0 items-center gap-3">
        <span className="bg-mark/10 text-mark flex size-10 shrink-0 items-center justify-center rounded-lg">
          <FileText aria-hidden className="size-5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{submission.document.filename}</span>
          <span className="text-muted-foreground block text-xs">
            {formatBytes(submission.document.sizeBytes)}
          </span>
        </span>
      </span>
      <Button asChild variant="outline" size="lg">
        {/* A plain link: this is a file download, not a page to prefetch. */}
        <a href={`/dashboard/submissions/${submission.id}/document`}>
          <Download aria-hidden />
          Download
        </a>
      </Button>
    </div>
  );
}
