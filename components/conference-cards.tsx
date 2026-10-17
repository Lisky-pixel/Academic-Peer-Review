import { CalendarClock, ChevronRight, FileStack, MapPin } from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { type ConferenceListDTO, PHASE_LABEL } from "@/lib/dto/conference";
import { formatDate } from "@/lib/format";

/** Conferences as frosted cards, each a link to its page. */
export function ConferenceCards({
  conferences,
  hrefOf,
}: {
  conferences: ConferenceListDTO[];
  hrefOf: (id: string) => string;
}) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
      {conferences.map((conference) => (
        <li key={conference.id}>
          <Link
            href={hrefOf(conference.id)}
            data-glow
            className="glass focus-visible:ring-ring/40 flex h-full flex-col gap-4 rounded-2xl p-5 transition-transform duration-200 outline-none hover:-translate-y-0.5 focus-visible:ring-3 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="font-heading text-lg leading-snug font-medium">
                {conference.name}
              </span>
              <ChevronRight aria-hidden className="text-muted-foreground mt-1 size-4 shrink-0" />
            </span>
            <span className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock aria-hidden className="size-4" />
                Call closes {formatDate(conference.closesAt)}
              </span>
              {conference.venue && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden className="size-4" />
                  {conference.venue}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <FileStack aria-hidden className="size-4" />
                {conference.papers} {conference.papers === 1 ? "paper" : "papers"}
                {conference.submissionLimit ? ` of ${conference.submissionLimit}` : ""}
              </span>
            </span>
            <span className="mt-auto">
              <StatusPill tone={conference.phase === "open" ? "success" : "progress"}>
                {PHASE_LABEL[conference.phase]}
              </StatusPill>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
