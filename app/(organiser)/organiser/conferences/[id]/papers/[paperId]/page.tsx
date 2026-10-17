import { Download, Scale, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { removeReviewerAction } from "@/app/(organiser)/organiser/actions";
import { AssignReviewerForm, DecisionForm } from "@/app/(organiser)/organiser/forms";
import { BackLink } from "@/components/back-link";
import { DocumentPane } from "@/components/document-pane";
import { RoleArea } from "@/components/role-area";
import { Recommendation, ScoreMeter } from "@/components/score";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  findConference,
  findConferencePaper,
  findPaperActivity,
  findReviewerOptions,
  organiserPreview,
} from "@/lib/conferences";
import { requireOrganiserOf } from "@/lib/conferences/guard";
import { actionLabel } from "@/lib/dto/admin";
import { type PaperAssignmentDTO, toPaperDetailDTO } from "@/lib/dto/conference";
import { formatBytes } from "@/lib/files/validate";
import { formatDate, isUuid } from "@/lib/format";
import { PAPER_TYPE_LABEL } from "@/lib/submissions/schema";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/submissions/stage";
import { DECIDABLE } from "@/lib/workflow/transitions";

export const metadata: Metadata = { title: "Paper" };

const ASSIGNMENT_LABEL: Record<PaperAssignmentDTO["status"], string> = {
  PENDING: "Not yet answered",
  ACCEPTED: "Writing the review",
  COMPLETED: "Review submitted",
  DECLINED: "Declined",
  CANCELLED: "Removed",
};

const time = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function OrganiserPaperPage({
  params,
}: PageProps<"/organiser/conferences/[id]/papers/[paperId]">) {
  const { id, paperId } = await params;
  const user = await requireOrganiserOf(id);
  if (!isUuid(paperId)) notFound();

  const [conference, record] = await Promise.all([
    findConference(id),
    findConferencePaper(id, paperId),
  ]);
  if (!conference || !record) notFound();
  const paper = toPaperDetailDTO(record);

  const [preview, options, activity] = await Promise.all([
    paper.file ? organiserPreview(id, paperId) : Promise.resolve({ type: "none" as const }),
    ["SUBMITTED", "UNDER_REVIEW", "REVIEWS_COMPLETE"].includes(paper.status)
      ? findReviewerOptions(id, paperId)
      : Promise.resolve([]),
    findPaperActivity(paperId),
  ]);

  const live = paper.assignments.filter((assignment) =>
    ["PENDING", "ACCEPTED", "COMPLETED"].includes(assignment.status),
  );
  const past = paper.assignments.filter(
    (assignment) => !["PENDING", "ACCEPTED", "COMPLETED"].includes(assignment.status),
  );
  const open = live.filter((assignment) => assignment.status !== "COMPLETED").length;
  const canDecide = DECIDABLE.includes(paper.status);
  const decided = paper.status === "ACCEPTED" || paper.status === "REJECTED";
  const base = `/organiser/conferences/${id}/papers/${paperId}`;

  return (
    <RoleArea
      user={user}
      wide
      title={paper.title}
      eyebrow={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <BackLink href={`/organiser/conferences/${id}`}>{conference.name}</BackLink>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs">{paper.reference}</span>
        </span>
      }
      actions={
        <StatusPill tone={STATUS_TONE[paper.status]}>{STATUS_LABEL[paper.status]}</StatusPill>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="reviews" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="reviews" className="font-heading text-2xl font-medium">
                Reviews
              </h2>
              {paper.reviewsIn > 0 && (
                <p className="text-muted-foreground text-sm">
                  Average {paper.averageScore}/5 · recommended by {paper.recommended} of{" "}
                  {paper.reviewsIn}
                </p>
              )}
            </div>

            {live.length === 0 ? (
              <p className="glass text-muted-foreground rounded-2xl p-5 text-sm leading-relaxed">
                No reviewer has this paper yet. Match reviewers from the conference page, or assign
                one below.
              </p>
            ) : (
              <ul className="space-y-4">
                {live.map((assignment) => (
                  <li key={assignment.id} className="glass space-y-4 rounded-2xl p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {assignment.reviewer.name}
                          {assignment.isTiebreaker && (
                            <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                              <Scale aria-hidden className="size-3" />
                              Tie-breaker
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {[assignment.reviewer.institution, assignment.reviewer.email]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className={assignment.overdue ? "text-warning font-medium" : ""}>
                          {ASSIGNMENT_LABEL[assignment.status]}
                        </p>
                        <p className="text-muted-foreground">
                          {assignment.status === "COMPLETED"
                            ? `Sent ${formatDate(assignment.completedAt!)}`
                            : `${assignment.overdue ? "Was due" : "Due"} ${formatDate(assignment.dueAt)}`}
                        </p>
                      </div>
                    </div>

                    {assignment.review?.submitted && (
                      <div className="border-border space-y-3 border-t pt-4">
                        <div className="flex flex-wrap items-center gap-3">
                          {assignment.review.score && (
                            <ScoreMeter score={assignment.review.score} />
                          )}
                          {assignment.review.recommend !== null && (
                            <Recommendation recommend={assignment.review.recommend} />
                          )}
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-line">
                          {assignment.review.comments}
                        </p>
                        {assignment.review.markedUpCopy && (
                          <Button asChild variant="outline" size="sm">
                            <a href={`${base}/files/${assignment.review.markedUpCopy.fileId}`}>
                              <Download aria-hidden />
                              Marked-up copy ·{" "}
                              {formatBytes(assignment.review.markedUpCopy.sizeBytes)}
                            </a>
                          </Button>
                        )}
                      </div>
                    )}

                    {!decided && assignment.status !== "COMPLETED" && (
                      <details className="text-sm">
                        <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">
                          Remove this reviewer
                        </summary>
                        <form
                          action={removeReviewerAction}
                          className="border-border mt-3 flex flex-wrap items-center gap-3 rounded-xl border p-3"
                        >
                          <input type="hidden" name="conferenceId" value={id} />
                          <input type="hidden" name="paperId" value={paperId} />
                          <input type="hidden" name="assignmentId" value={assignment.id} />
                          <p className="text-muted-foreground min-w-0 flex-1 basis-52">
                            They will be told the review is no longer needed.
                          </p>
                          <Button type="submit" variant="destructive" size="sm">
                            Remove
                          </Button>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {past.length > 0 && (
              <details className="glass rounded-2xl p-5 text-sm">
                <summary className="cursor-pointer font-medium">
                  Declined or removed ({past.length})
                </summary>
                <ul className="mt-4 space-y-3">
                  {past.map((assignment) => (
                    <li key={assignment.id}>
                      <span className="font-medium">{assignment.reviewer.name}</span> ·{" "}
                      {assignment.conflictDeclared
                        ? "declared a conflict of interest"
                        : ASSIGNMENT_LABEL[assignment.status].toLowerCase()}
                      {assignment.declineReason && (
                        <span className="text-muted-foreground">
                          {" "}
                          — “{assignment.declineReason}”
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {paper.file && (
            <DocumentPane
              label="The paper"
              filename={paper.file.filename}
              sizeBytes={paper.file.sizeBytes}
              downloadHref={`${base}/files/${paper.file.id}`}
              preview={preview}
            />
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
              <Detail term="Submitted by">
                {paper.submitter.name} · {paper.submitter.email}
              </Detail>
              <Detail term="Submitted">
                {paper.submittedAt ? formatDate(paper.submittedAt) : "—"}
              </Detail>
              <Detail term="Topic">{paper.topic}</Detail>
              <Detail term="Discipline">{paper.discipline}</Detail>
              <Detail term="Type">{PAPER_TYPE_LABEL[paper.paperType]}</Detail>
              <Detail term="Originality declaration">
                {paper.declarationAt ? `Confirmed ${formatDate(paper.declarationAt)}` : "—"}
              </Detail>
            </dl>
            <div className="border-border mt-6 space-y-2 border-t pt-6">
              <h3 className="text-muted-foreground text-sm font-medium">Abstract</h3>
              <p className="leading-relaxed whitespace-pre-line">{paper.abstract}</p>
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          {decided ? (
            <section className="glass space-y-3 rounded-3xl p-6">
              <h2 className="font-heading text-xl font-medium">
                {paper.status === "ACCEPTED" ? "Accepted" : "Rejected"}
              </h2>
              <p className="text-muted-foreground text-sm">
                By {paper.decidedBy} on {formatDate(paper.decidedAt!)}. The submitter has been
                emailed and can read the reviews.
              </p>
              {paper.decisionNote && (
                <p className="text-sm leading-relaxed whitespace-pre-line">{paper.decisionNote}</p>
              )}
            </section>
          ) : canDecide ? (
            <section className="glass space-y-4 rounded-3xl p-6">
              <div className="flex items-start gap-3">
                {paper.status === "REVIEWS_COMPLETE" && (
                  <span className="bg-warning/15 text-warning flex size-9 shrink-0 items-center justify-center rounded-xl">
                    <Sparkles aria-hidden className="size-[18px]" strokeWidth={1.75} />
                  </span>
                )}
                <div className="space-y-1">
                  <h2 className="font-heading text-xl font-medium">Decision</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {paper.status === "REVIEWS_COMPLETE"
                      ? "Every review is in."
                      : "Reviews are still coming in. You can decide now if you need to."}
                  </p>
                </div>
              </div>
              <DecisionForm conferenceId={id} paperId={paperId} waitingFor={open} />
            </section>
          ) : null}

          {["SUBMITTED", "UNDER_REVIEW", "REVIEWS_COMPLETE"].includes(paper.status) && (
            <section className="glass rounded-3xl p-6">
              <AssignReviewerForm
                conferenceId={id}
                paperId={paperId}
                options={options}
                maxLoad={conference.maxPapersPerReviewer}
              />
            </section>
          )}

          <section aria-labelledby="history" className="glass rounded-3xl p-6">
            <h2 id="history" className="font-heading mb-4 text-xl font-medium">
              History
            </h2>
            <ol className="border-border space-y-4 border-l pl-5 text-sm">
              {activity.map((entry) => (
                <li key={entry.id} className="relative">
                  <span
                    aria-hidden
                    className="bg-mark absolute top-1.5 -left-[1.4rem] size-2 rounded-full"
                  />
                  <p className="font-medium">{actionLabel(entry.action)}</p>
                  <p className="text-muted-foreground">
                    {entry.actor?.name ?? "System"} · {time.format(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
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
