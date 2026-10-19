import { CalendarCheck, ChevronRight, FileStack, Plus, UserRoundCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConferenceCards } from "@/components/conference-cards";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { findConferencesFor } from "@/lib/conferences";
import { findPlatformCounts } from "@/lib/admin/users";
import { findConferenceRequests } from "@/lib/billing";
import { toConferenceListDTO } from "@/lib/dto/conference";

export const metadata: Metadata = { title: "Conferences" };

export default async function AdminHomePage() {
  const user = await requireRole("ADMIN");
  const [records, counts, requests] = await Promise.all([
    findConferencesFor(user),
    findPlatformCounts(),
    findConferenceRequests(),
  ]);
  const conferences = records
    .map((record) => toConferenceListDTO(record))
    .filter((conference) => conference.status !== "PENDING");

  return (
    <RoleArea
      user={user}
      wide
      title="Conferences"
      description="Every conference on the platform. Open one to run its papers and reviews; use Settings to change it."
      current="/admin"
      actions={
        <Button asChild size="lg" className="h-10 px-4 text-sm">
          <Link href="/admin/conferences/new">
            <Plus aria-hidden />
            New conference
          </Link>
        </Button>
      }
    >
      <StatTiles
        stats={[
          {
            label: "Open for papers",
            icon: CalendarCheck,
            value: conferences.filter((conference) => conference.phase === "open").length,
          },
          {
            label: "Papers submitted",
            icon: FileStack,
            value: conferences.reduce((sum, conference) => sum + conference.papers, 0),
          },
          {
            label: "Reviewers",
            icon: UserRoundCheck,
            value: counts.reviewers,
            href: "/admin/users?role=REVIEWER",
          },
          {
            label: "Submitters",
            icon: Users,
            value: counts.submitters,
            href: "/admin/users?role=USER",
          },
        ]}
      />

      {requests.length > 0 && (
        <section aria-labelledby="requests" className="space-y-3">
          <h2 id="requests" className="font-heading text-2xl font-medium">
            Conference requests
          </h2>
          <ul className="glass divide-border divide-y overflow-hidden rounded-2xl">
            {requests.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/admin/conferences/${request.id}`}
                  className="hover:bg-muted/60 focus-visible:bg-muted/60 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors outline-none sm:px-6"
                >
                  <span className="min-w-0 flex-1 basis-64 space-y-1">
                    <span className="block truncate font-medium">{request.name}</span>
                    <span className="text-muted-foreground block text-sm">
                      {request.requestedBy?.name ?? "—"} · {request.packageName} package
                      {request.invoice ? ` · ${request.invoice.amount}` : ""}
                    </span>
                  </span>
                  <StatusPill tone={request.invoice?.status === "PAID" ? "success" : "warning"}>
                    {request.invoice?.status === "PAID"
                      ? "Paid, ready to approve"
                      : "Awaiting payment"}
                  </StatusPill>
                  <ChevronRight aria-hidden className="text-muted-foreground size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {conferences.length === 0 ? (
        <p className="glass text-muted-foreground rounded-2xl p-6 leading-relaxed">
          No conferences yet. Create one to open its call for papers.
        </p>
      ) : (
        <ConferenceCards
          conferences={conferences}
          hrefOf={(conference) =>
            conference.status === "ACTIVE"
              ? `/organiser/conferences/${conference.id}`
              : `/admin/conferences/${conference.id}`
          }
        />
      )}
    </RoleArea>
  );
}
