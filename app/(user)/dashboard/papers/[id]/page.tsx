import { Check, Download, FileText, PartyPopper, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PaperUploader,
  SubmitPanel,
  WithdrawPanel,
} from "@/app/(user)/dashboard/papers/[id]/panels";
import { BackLink } from "@/components/back-link";
import { RoleArea } from "@/components/role-area";
import { Recommendation, ScoreMeter } from "@/components/score";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { toUserPaperDTO, toUserReviewDTOs } from "@/lib/dto/submission";
import { env } from "@/lib/env";
import { formatBytes } from "@/lib/files/validate";
import { formatDate, isUuid } from "@/lib/format";
import { findOwnPaper, findOwnReviews } from "@/lib/submissions";
import { PAPER_TYPE_LABEL } from "@/lib/submissions/schema";
import { PROGRESS_STEPS, progressOf, STAGE_LABEL, STAGE_TONE } from "@/lib/submissions/stage";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/dashboard/papers/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: isUuid(id) ? "Paper" : "Not found" };
}

export default async function PaperPage({ params }: PageProps<"/dashboard/papers/[id]">) {
  const user = await requireRole("USER", "REVIEWER");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const record = await findOwnPaper(user.id, id);
  if (!record) notFound();
  const paper = toUserPaperDTO(record);
  const decided = paper.stage === "accepted" || paper.stage === "rejected";
  const reviews = decided ? toUserReviewDTOs(await findOwnReviews(user.id, id)) : [];
  const isDraft = paper.stage === "draft";
  const needsFile = paper.conference.format === "FULL_PAPER";

  const missing = !paper.conference.open
    ? "This conference is no longer taking papers."
    : needsFile && !paper.file
      ? "Attach the full paper to submit."
      : null;

  return (
    <RoleArea
      user={user}
      title={paper.title}
      eyebrow={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <BackLink href="/dashboard">My papers</BackLink>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs">{paper.reference}</span>
        </span>
      }
      description={paper.conference.name}
      actions={
        <span className="flex items-center gap-2">
          <StatusPill tone={STAGE_TONE[paper.stage]}>{STAGE_LABEL[paper.stage]}</StatusPill>
          {paper.canEdit && (
            <Button asChild variant="outline" size="lg">
              <Link href={`/dashboard/papers/${paper.id}/edit`}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
          )}
        </span>
      }
    >
      {!isDraft && paper.stage !== "withdrawn" && <ProgressTrack stage={paper.stage} />}

      {decided && (
        <section
          aria-labelledby="decision"
          className={cn(
            "glass rounded-3xl p-6 sm:p-8",
            paper.stage === "accepted" && "ring-success/30 ring-1",
          )}
        >
          <div className="flex items-start gap-4">
            {paper.stage === "accepted" && (
              <span className="bg-success/10 text-success flex size-11 shrink-0 items-center justify-center rounded-2xl">
                <PartyPopper aria-hidden className="size-5" strokeWidth={1.75} />
              </span>
            )}
            <div className="min-w-0 space-y-2">
              <h2 id="decision" className="font-heading text-2xl font-medium">
                {paper.stage === "accepted"
                  ? "Your paper has been accepted"
                  : "Your paper was not accepted this time"}
              </h2>
              <p className="text-muted-foreground text-sm">
                Decided on {formatDate(paper.decidedAt!)}
              </p>
              {paper.decisionNote && (
                <p className="leading-relaxed whitespace-pre-line">{paper.decisionNote}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {decided && (
        <section aria-labelledby="reviews" className="space-y-4">
          <h2 id="reviews" className="font-heading text-2xl font-medium">
            The reviews
          </h2>
          {reviews.length === 0 ? (
            <p className="text-muted-foreground">
              No written reviews were returned for this paper.
            </p>
          ) : (
            <ol className="space-y-4">
              {reviews.map((review) => (
                <li key={review.reviewer} className="glass space-y-4 rounded-2xl p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-medium">{review.reviewer}</h3>
                    <div className="flex flex-wrap items-center gap-3">
                      <ScoreMeter score={review.score} />
                      <Recommendation recommend={review.recommend} />
                    </div>
                  </div>
                  <p className="leading-relaxed whitespace-pre-line">{review.comments}</p>
                  {review.markedUpCopy && (
                    <Button asChild variant="outline" size="lg">
                      <a
                        href={`/dashboard/papers/${paper.id}/reviews/${review.markedUpCopy.fileId}`}
                      >
                        <Download aria-hidden />
                        Marked-up copy · {formatBytes(review.markedUpCopy.sizeBytes)}
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="text-muted-foreground text-sm">
            Reviewers are anonymous. The marked-up copies have had their names removed.
          </p>
        </section>
      )}

      {paper.canEdit && (
        <section aria-labelledby="file" className="glass space-y-4 rounded-3xl p-6 sm:p-8">
          <div className="space-y-1">
            <h2 id="file" className="font-heading text-xl font-medium">
              {needsFile ? "The full paper" : "The paper (optional)"}
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              PDF or Word. Remove the authors’ names from the text first; we also strip names from
              the file’s properties when you upload it.
            </p>
          </div>
          <PaperUploader paperId={paper.id} file={paper.file} maxBytes={env.MAX_UPLOAD_BYTES} />
        </section>
      )}

      {isDraft && (
        <section aria-labelledby="submit" className="glass space-y-4 rounded-3xl p-6 sm:p-8">
          <h2 id="submit" className="font-heading text-xl font-medium">
            Submit
          </h2>
          <SubmitPanel paperId={paper.id} canSubmit={paper.canSubmit} missing={missing} />
        </section>
      )}

      <section aria-labelledby="details" className="glass rounded-3xl p-6 sm:p-8">
        <h2 id="details" className="font-heading mb-5 text-xl font-medium">
          Details
        </h2>
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
          <Detail term="Author(s)">{paper.authorNames}</Detail>
          <Detail term="Main author">
            {paper.contactEmail}
            <br />
            {paper.institution}
          </Detail>
          <Detail term="Topic">{paper.topic}</Detail>
          <Detail term="Discipline">{paper.discipline}</Detail>
          <Detail term="Type">{PAPER_TYPE_LABEL[paper.paperType]}</Detail>
          <Detail term={paper.submittedAt ? "Submitted" : "Started"}>
            {formatDate(paper.submittedAt ?? paper.createdAt)}
          </Detail>
          {!paper.canEdit && paper.file && (
            <Detail term="File">
              <a
                href={`/dashboard/papers/${paper.id}/file`}
                className="text-mark inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
              >
                <FileText aria-hidden className="size-4" />
                {paper.file.filename}
              </a>
            </Detail>
          )}
        </dl>
        <div className="border-border mt-6 space-y-2 border-t pt-6">
          <h3 className="text-muted-foreground text-sm font-medium">Abstract</h3>
          <p className="leading-relaxed whitespace-pre-line">{paper.abstract}</p>
        </div>
      </section>

      {paper.canWithdraw && <WithdrawPanel paperId={paper.id} isDraft={isDraft} />}
    </RoleArea>
  );
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function ProgressTrack({ stage }: { stage: Parameters<typeof progressOf>[0] }) {
  const done = progressOf(stage);
  return (
    <ol className="glass grid grid-cols-3 gap-2 rounded-2xl p-3 sm:p-4">
      {PROGRESS_STEPS.map((step, index) => {
        const complete = index < done;
        const label =
          index === PROGRESS_STEPS.length - 1 && stage === "rejected" ? "Decision" : step.label;
        return (
          <li
            key={step.label}
            className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:flex-row sm:gap-2.5 sm:text-left"
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                complete
                  ? "bg-mark text-white dark:text-[#0d121c]"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {complete ? <Check aria-hidden className="size-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-xs sm:truncate sm:text-sm",
                complete ? "font-medium" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
