import { CalendarClock, Check, Download, EyeOff, Scale } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { acceptAction } from "@/app/(reviewer)/reviewer/reviews/[id]/actions";
import {
  DeclineForm,
  MarkedUpUploader,
  ReviewForm,
} from "@/app/(reviewer)/reviewer/reviews/[id]/forms";
import { BackLink } from "@/components/back-link";
import { DocumentPane } from "@/components/document-pane";
import { FormMessage } from "@/components/form";
import { RoleArea } from "@/components/role-area";
import { Recommendation, ScoreMeter } from "@/components/score";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { toReviewerPaperDTO } from "@/lib/dto/review";
import { env } from "@/lib/env";
import { formatDate, isUuid } from "@/lib/format";
import { findReviewerPaper } from "@/lib/reviews";
import { findDocumentPreview } from "@/lib/reviews/preview";
import { PAPER_TYPE_LABEL } from "@/lib/submissions/schema";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<"/reviewer/reviews/[id]">) {
  const user = await requireRole("REVIEWER");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const record = await findReviewerPaper(user.id, id);
  const paper = record ? toReviewerPaperDTO(record) : null;
  if (!paper) notFound();

  const { sent } = await searchParams;
  const pending = paper.assignment.status === "PENDING";
  const submitted = paper.review?.submitted ?? false;
  const preview =
    paper.file && !pending ? await findDocumentPreview(user.id, id) : ({ type: "none" } as const);

  return (
    <RoleArea
      user={user}
      wide
      title={paper.title}
      eyebrow={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <BackLink href="/reviewer">Reviews</BackLink>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs">{paper.reference}</span>
        </span>
      }
      description={paper.conferenceName}
    >
      {sent && submitted && (
        <FormMessage tone="success">
          Thank you. Your review has been sent to the organisers.
        </FormMessage>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="about" className="glass space-y-5 rounded-3xl p-6 sm:p-8">
            <div className="flex flex-wrap gap-2 text-xs">
              <Chip>{paper.topic}</Chip>
              <Chip>{paper.discipline}</Chip>
              <Chip>{PAPER_TYPE_LABEL[paper.paperType]}</Chip>
              {paper.assignment.isTiebreaker && (
                <Chip>
                  <Scale aria-hidden className="size-3.5" />
                  Tie-breaker
                </Chip>
              )}
            </div>
            <div className="space-y-2">
              <h2 id="about" className="text-muted-foreground text-sm font-medium">
                Abstract
              </h2>
              <p className="leading-relaxed whitespace-pre-line">{paper.abstract}</p>
            </div>
            <div className="border-border text-muted-foreground border-t pt-5 text-sm">
              {paper.doubleBlind ? (
                <p className="flex items-start gap-2">
                  <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0" />
                  This is a double-blind review: the authors are hidden from you, and you are hidden
                  from them.
                </p>
              ) : (
                <p>
                  <span className="text-foreground font-medium">{paper.authorNames}</span>
                  {paper.institution && <> · {paper.institution}</>}
                </p>
              )}
            </div>
          </section>

          {paper.file && !pending && (
            <DocumentPane
              label="The paper"
              filename={paper.file.filename}
              sizeBytes={paper.file.sizeBytes}
              downloadHref={`/reviewer/reviews/${paper.id}/paper`}
              preview={preview}
            />
          )}
          {!paper.file && paper.format === "ABSTRACT_ONLY" && (
            <p className="glass text-muted-foreground rounded-2xl p-5 text-sm">
              This conference reviews abstracts. The authors did not attach a full paper.
            </p>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="glass flex items-center gap-3 rounded-2xl p-4 text-sm">
            <CalendarClock aria-hidden className="text-mark size-5 shrink-0" strokeWidth={1.75} />
            <span>
              {submitted ? (
                <>Sent on {formatDate(paper.review!.submittedAt!)}</>
              ) : (
                <>
                  Due by <span className="font-medium">{formatDate(paper.assignment.dueAt)}</span>
                </>
              )}
            </span>
          </div>

          {pending && (
            <section aria-labelledby="answer" className="glass space-y-5 rounded-3xl p-6">
              <div className="space-y-2">
                <h2 id="answer" className="font-heading text-xl font-medium">
                  Will you review this paper?
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  You were matched by discipline. Accept to open the full paper and write your
                  review.
                </p>
              </div>
              <form action={acceptAction}>
                <input type="hidden" name="paperId" value={paper.id} />
                <Button type="submit" size="lg" className="h-11 w-full text-sm">
                  <Check aria-hidden />
                  Accept and start
                </Button>
              </form>
              <DeclineForm paperId={paper.id} />
            </section>
          )}

          {!pending && paper.canWrite && (
            <>
              <section aria-labelledby="your-review" className="glass rounded-3xl p-6">
                <h2 id="your-review" className="font-heading mb-5 text-xl font-medium">
                  Your review
                </h2>
                <ReviewForm
                  paperId={paper.id}
                  initial={{
                    score: paper.review?.score ?? null,
                    recommend: paper.review?.recommend ?? null,
                    comments: paper.review?.comments ?? "",
                  }}
                />
              </section>
              <section aria-labelledby="marked-up" className="glass space-y-4 rounded-3xl p-6">
                <div className="space-y-1">
                  <h2 id="marked-up" className="font-heading text-xl font-medium">
                    Marked-up copy{" "}
                    <span className="text-muted-foreground text-base">(optional)</span>
                  </h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Download the paper, add your comments and tracked changes, and upload it here.
                    Your name is removed from the file before anyone sees it.
                  </p>
                </div>
                <MarkedUpUploader
                  paperId={paper.id}
                  current={paper.review?.markedUpCopy ?? null}
                  maxBytes={env.MAX_UPLOAD_BYTES}
                />
              </section>
              <DeclineForm paperId={paper.id} />
            </>
          )}

          {submitted && paper.review && (
            <section aria-labelledby="sent-review" className="glass space-y-4 rounded-3xl p-6">
              <h2 id="sent-review" className="font-heading text-xl font-medium">
                Your review
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                {paper.review.score && <ScoreMeter score={paper.review.score} />}
                {paper.review.recommend !== null && (
                  <Recommendation recommend={paper.review.recommend} />
                )}
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-line">{paper.review.comments}</p>
              {paper.review.markedUpCopy && (
                <Button asChild variant="outline" size="lg">
                  <a href={`/reviewer/reviews/${paper.id}/annotated`}>
                    <Download aria-hidden />
                    Your marked-up copy
                  </a>
                </Button>
              )}
            </section>
          )}

          {!pending && !paper.canWrite && !submitted && (
            <p className="glass text-muted-foreground rounded-2xl p-5 text-sm leading-relaxed">
              A decision has been made on this paper, so your review is no longer needed. Thank you.
            </p>
          )}
        </aside>
      </div>
    </RoleArea>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium">
      {children}
    </span>
  );
}
