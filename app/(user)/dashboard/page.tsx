import {
  CalendarClock,
  ChevronRight,
  CircleCheck,
  FilePen,
  Hourglass,
  MapPin,
  Send,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { toUserPaperDTO } from "@/lib/dto/submission";
import { formatDate } from "@/lib/format";
import { findOpenConferences, findOwnPapers } from "@/lib/submissions";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/submissions/stage";

export const metadata: Metadata = { title: "My papers" };

export default async function MyPapersPage() {
  const user = await requireRole("USER", "REVIEWER");
  const [records, conferences] = await Promise.all([findOwnPapers(user.id), findOpenConferences()]);
  const papers = records.map((record) => toUserPaperDTO(record));

  return (
    <RoleArea
      user={user}
      title="My papers"
      description="Submit to a conference and follow each paper through review."
      current="/dashboard"
    >
      {papers.length > 0 && (
        <StatTiles
          stats={[
            {
              label: "Drafts",
              icon: FilePen,
              value: papers.filter((paper) => paper.stage === "draft").length,
            },
            {
              label: "Under review",
              icon: Hourglass,
              value: papers.filter((paper) => ["submitted", "under_review"].includes(paper.stage))
                .length,
            },
            {
              label: "Decided",
              icon: CircleCheck,
              value: papers.filter((paper) => ["accepted", "rejected"].includes(paper.stage))
                .length,
            },
          ]}
        />
      )}

      <section aria-labelledby="open-calls" className="space-y-4">
        <h2 id="open-calls" className="font-heading text-2xl font-medium">
          Open calls for papers
        </h2>
        {conferences.length === 0 ? (
          <p className="glass text-muted-foreground rounded-2xl p-6 leading-relaxed">
            No conference is taking papers right now. Calls appear here as soon as they open.
          </p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            {conferences.map((conference) => (
              <li
                key={conference.id}
                data-glow
                className="glass flex flex-col justify-between gap-5 rounded-2xl p-5 sm:p-6"
              >
                <div className="space-y-2">
                  <h3 className="font-heading text-lg leading-snug font-medium">
                    {conference.name}
                  </h3>
                  <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock aria-hidden className="size-4" />
                      Closes {formatDate(conference.submissionsCloseAt)}
                    </span>
                    {conference.venue && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin aria-hidden className="size-4" />
                        {conference.venue}
                      </span>
                    )}
                  </p>
                  {conference.description && (
                    <p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed">
                      {conference.description}
                    </p>
                  )}
                </div>
                <div>
                  <Button asChild size="lg" className="h-10 px-4 text-sm">
                    <Link href={`/dashboard/papers/new?conference=${conference.id}`}>
                      <Send aria-hidden />
                      Submit a paper
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-papers" className="space-y-4">
        <h2 id="my-papers" className="font-heading text-2xl font-medium">
          Your papers
        </h2>
        {papers.length === 0 ? (
          <p className="glass text-muted-foreground rounded-2xl p-6 leading-relaxed">
            You have not submitted a paper yet. Choose an open call above to start.
          </p>
        ) : (
          <ul className="glass divide-border divide-y overflow-hidden rounded-2xl">
            {papers.map((paper) => (
              <li key={paper.id}>
                <Link
                  href={`/dashboard/papers/${paper.id}`}
                  className="hover:bg-muted/60 focus-visible:bg-muted/60 flex items-center gap-4 px-5 py-4 transition-colors outline-none sm:px-6"
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate font-medium">{paper.title}</span>
                    <span className="text-muted-foreground flex flex-wrap gap-x-3 text-sm">
                      <span className="font-mono text-xs leading-5">{paper.reference}</span>
                      <span className="truncate">{paper.conference.name}</span>
                    </span>
                  </span>
                  <StatusPill tone={STAGE_TONE[paper.stage]}>{STAGE_LABEL[paper.stage]}</StatusPill>
                  <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RoleArea>
  );
}
