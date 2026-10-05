import { Check, Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { acceptAction } from "@/app/(reviewer)/reviewer/reviews/[id]/actions";
import { DeclineForm } from "@/app/(reviewer)/reviewer/reviews/[id]/decline-form";
import { PdfPreview } from "@/app/(reviewer)/reviewer/reviews/[id]/pdf-preview";
import { ReviewForm } from "@/app/(reviewer)/reviewer/reviews/[id]/review-form";
import { BackLink } from "@/components/back-link";
import { FormMessage } from "@/components/form";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { type ReviewerSubmissionDTO, toReviewerSubmissionDTO } from "@/lib/dto/review";
import { env } from "@/lib/env";
import { formatBytes } from "@/lib/files/validate";
import { formatDate, isUuid } from "@/lib/format";
import { findReviewerSubmission, findTemplateFor } from "@/lib/reviews";
import { type DocumentPreview, findDocumentPreview, previewDocument } from "@/lib/reviews/preview";

export const metadata: Metadata = { title: "Review" };

const PHASE_LABEL = {
  invited: "Waiting for your answer",
  working: "In progress",
  submitted: "Submitted",
} as const;

export default async function ReviewPage({ params }: PageProps<"/reviewer/reviews/[id]">) {
  const user = await requireRole("REVIEWER");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Scoped to submissions this reviewer holds: anything else is not found.
  const record = await findReviewerSubmission(user.id, id);
  if (!record) notFound();
  const template = await findTemplateFor(record);
  const submission = toReviewerSubmissionDTO(record, template, user.id);

  const preview =
    submission.phase === "invited" ? null : await findDocumentPreview(user.id, submission.id);

  return (
    <RoleArea
      user={user}
      wide={submission.phase !== "invited"}
      eyebrow={<BackLink href="/reviewer">Review queue</BackLink>}
      title={submission.title}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="tabular-nums">{submission.reference}</span>
          <span>{submission.documentType}</span>
          <StatusPill tone={submission.phase === "submitted" ? "success" : "progress"}>
            {submission.revisionRequested ? "Changes requested" : PHASE_LABEL[submission.phase]}
          </StatusPill>
          {submission.dueAt && (
            <span className={submission.overdue ? "text-warning font-medium" : undefined}>
              {submission.overdue ? "Overdue since" : "Due"} {formatDate(submission.dueAt)}
            </span>
          )}
        </span>
      }
      current="/reviewer"
    >
      {submission.phase === "invited" && <Invitation submission={submission} />}

      {submission.phase !== "invited" && preview && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-10 lg:grid-cols-2">
          <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <DocumentPane submission={submission} preview={preview} />
            <Brief submission={submission} />
          </div>

          <div className="min-w-0">
            {submission.phase === "working" ? (
              <>
                {submission.revisionRequested && (
                  <FormMessage tone="error" className="mb-8">
                    <span className="font-medium">The administrator asked for changes.</span>
                    {submission.revisionNote && (
                      <span className="mt-1 block whitespace-pre-wrap">
                        {submission.revisionNote}
                      </span>
                    )}
                  </FormMessage>
                )}
                <ReviewForm
                  submissionId={submission.id}
                  criteria={submission.criteria}
                  initialAnswers={submission.answers}
                  annotated={submission.annotated}
                  maxBytes={env.MAX_UPLOAD_BYTES}
                  revisionRequested={submission.revisionRequested}
                />
              </>
            ) : (
              <SubmittedReview submission={submission} />
            )}
          </div>
        </div>
      )}
    </RoleArea>
  );
}

function Brief({ submission }: { submission: ReviewerSubmissionDTO }) {
  const rows: Array<[string, string | null]> = [
    ["Written by", submission.authorName ?? "Hidden for this review"],
    ["What it is for", submission.purpose],
    ["Instructions", submission.instructions],
    ["Where to focus", submission.focusAreas],
    ["Anything else", submission.description],
  ];

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xl font-medium">What the author asked for</h2>
      <dl className="border-border divide-border divide-y border-y">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-5"
            >
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="text-sm leading-relaxed whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

/** Before accepting: the brief, and the two answers. */
function Invitation({ submission }: { submission: ReviewerSubmissionDTO }) {
  return (
    <div className="max-w-2xl space-y-10">
      <Brief submission={submission} />
      <div className="space-y-5">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Accept to read the document and write your review
          {submission.dueAt ? `, due ${formatDate(submission.dueAt)}` : ""}. The author will never
          be told who reviewed their work.
        </p>
        <form action={acceptAction}>
          <input type="hidden" name="submissionId" value={submission.id} />
          <Button type="submit" size="lg" className="h-11 px-5 text-sm">
            <Check aria-hidden />
            Accept assignment
          </Button>
        </form>
        <DeclineForm submissionId={submission.id} />
      </div>
    </div>
  );
}

function DocumentPane({
  submission,
  preview,
}: {
  submission: ReviewerSubmissionDTO;
  preview: DocumentPreview;
}) {
  return (
    <section
      aria-label="The document"
      className="border-border bg-card overflow-hidden rounded-2xl border"
    >
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <FileText aria-hidden className="text-mark size-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate text-sm font-medium">{submission.document?.filename}</span>
          {submission.document && (
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatBytes(submission.document.sizeBytes)}
            </span>
          )}
        </span>
        <Button asChild variant="outline" size="sm">
          <a href={`/reviewer/reviews/${submission.id}/document`}>
            <Download aria-hidden />
            Download
          </a>
        </Button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
        {preview.type === "pdf" && <PdfPreview url={preview.url} />}
        {preview.type === "html" && (
          // An empty sandbox: the converted document can run no script, submit
          // no form and reach nothing outside its own frame.
          <iframe
            title="Document preview"
            sandbox=""
            srcDoc={previewDocument(preview.html)}
            className="block h-[70vh] w-full bg-white"
          />
        )}
        {preview.type === "text" && (
          <pre className="p-6 font-sans text-sm leading-relaxed whitespace-pre-wrap">
            {preview.text}
          </pre>
        )}
        {preview.type === "none" && (
          <p className="text-muted-foreground px-6 py-14 text-center text-sm leading-relaxed">
            This kind of file cannot be previewed here. Download it to read it.
          </p>
        )}
      </div>
    </section>
  );
}

/** After submitting: what was sent, read-only. */
function SubmittedReview({ submission }: { submission: ReviewerSubmissionDTO }) {
  return (
    <div className="space-y-8">
      <FormMessage tone="success">
        Submitted{submission.submittedAt ? ` ${formatDate(submission.submittedAt)}` : ""}. An
        administrator will read it before it reaches the author.
      </FormMessage>

      <section className="space-y-5">
        <h2 className="font-heading text-xl font-medium">Your review</h2>
        <dl className="space-y-6">
          {submission.criteria.map((criterion) => {
            const answer = submission.answers[criterion.id];
            return (
              <div key={criterion.id} className="space-y-1.5">
                <dt className="flex flex-wrap items-baseline justify-between gap-x-4 font-medium">
                  {criterion.label}
                  {answer?.rating != null && (
                    <span className="text-mark text-sm tabular-nums">
                      {answer.rating} of {criterion.maxRating}
                    </span>
                  )}
                </dt>
                <dd className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
                  {answer?.comment || (answer?.rating == null ? "No answer" : "")}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {submission.annotated && (
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-medium">Annotated copy</h2>
          <div className="border-border bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {submission.annotated.filename}
              </span>
              <span className="text-muted-foreground block text-xs">
                {formatBytes(submission.annotated.sizeBytes)} · your name has been removed
              </span>
            </span>
            <Button asChild variant="outline" size="lg">
              <a href={`/reviewer/reviews/${submission.id}/annotated`}>
                <Download aria-hidden />
                Download
              </a>
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
