import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { toUserSubmissionDTO } from "@/lib/dto/submission";
import { formatDate } from "@/lib/format";
import { findOwnSubmissions } from "@/lib/submissions";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/submissions/stage";

export const metadata: Metadata = { title: "Your submissions" };

function NewSubmissionButton() {
  return (
    <Button asChild size="lg" className="h-10 px-4 text-sm">
      <Link href="/dashboard/submissions/new">
        <Plus aria-hidden />
        New submission
      </Link>
    </Button>
  );
}

export default async function UserDashboardPage() {
  const user = await requireRole("USER");
  const submissions = (await findOwnSubmissions(user.id)).map(toUserSubmissionDTO);

  return (
    <RoleArea
      user={user}
      title="Your submissions"
      description="Every document you have sent for review, and where each one stands."
      current="/dashboard"
      actions={submissions.length > 0 ? <NewSubmissionButton /> : undefined}
    >
      {submissions.length > 0 && (
        <StatTiles
          stats={[
            {
              label: "In progress",
              value: submissions.filter((s) =>
                ["awaiting_reviewer", "with_reviewer", "in_review", "final_checks"].includes(
                  s.stage,
                ),
              ).length,
            },
            {
              label: "Ready to read",
              value: submissions.filter((s) => s.stage === "ready").length,
              tone: "attention",
            },
            {
              label: "Completed",
              value: submissions.filter((s) => s.stage === "completed").length,
            },
            { label: "Drafts", value: submissions.filter((s) => s.stage === "draft").length },
          ]}
        />
      )}

      {submissions.length === 0 ? (
        <div className="border-border rounded-2xl border border-dashed px-6 py-16 text-center">
          <p className="font-heading text-2xl font-medium">Nothing here yet</p>
          <p className="text-muted-foreground mx-auto mt-2 mb-7 max-w-md text-sm leading-relaxed text-pretty">
            Send in a document and a reviewer will read it against clear criteria and return
            feedback with a marked-up copy.
          </p>
          <NewSubmissionButton />
        </div>
      ) : (
        <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-2xl border">
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Link
                href={`/dashboard/submissions/${submission.id}`}
                className="hover:bg-muted/60 focus-visible:bg-muted/60 flex items-center gap-4 px-5 py-4 transition-colors outline-none sm:px-6"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate font-medium">{submission.title}</p>
                  <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                    <span className="tabular-nums">{submission.reference}</span>
                    <span>{submission.documentType.name}</span>
                    {submission.deadline && <span>Due {formatDate(submission.deadline)}</span>}
                  </p>
                </div>
                <StatusPill tone={STAGE_TONE[submission.stage]}>
                  {STAGE_LABEL[submission.stage]}
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
    </RoleArea>
  );
}
