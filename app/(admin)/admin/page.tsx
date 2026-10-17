import { CalendarCheck, FileStack, Plus, UserRoundCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConferenceCards } from "@/components/conference-cards";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { findConferencesFor } from "@/lib/conferences";
import { findPlatformCounts } from "@/lib/admin/users";
import { toConferenceListDTO } from "@/lib/dto/conference";

export const metadata: Metadata = { title: "Conferences" };

export default async function AdminHomePage() {
  const user = await requireRole("ADMIN");
  const [records, counts] = await Promise.all([findConferencesFor(user), findPlatformCounts()]);
  const conferences = records.map((record) => toConferenceListDTO(record));

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

      {conferences.length === 0 ? (
        <p className="glass text-muted-foreground rounded-2xl p-6 leading-relaxed">
          No conferences yet. Create one to open its call for papers.
        </p>
      ) : (
        <ConferenceCards
          conferences={conferences}
          hrefOf={(id) => `/organiser/conferences/${id}`}
        />
      )}
    </RoleArea>
  );
}
