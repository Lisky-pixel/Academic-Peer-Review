import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { ConferenceCards } from "@/components/conference-cards";
import { RoleArea } from "@/components/role-area";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { findConferencesFor } from "@/lib/conferences";
import { toConferenceListDTO } from "@/lib/dto/conference";

export const metadata: Metadata = { title: "Conferences" };

export default async function OrganiserHomePage() {
  const user = await requireRole("ORGANISER", "ADMIN");
  const conferences = (await findConferencesFor(user)).map((record) => toConferenceListDTO(record));

  return (
    <RoleArea
      user={user}
      title="Your conferences"
      description="The conferences you run. Open one to see its papers, reviewers and reports."
      current="/organiser"
      actions={
        user.role === "ORGANISER" ? (
          <Button asChild size="lg" className="h-10 px-4 text-sm">
            <Link href="/organiser/conferences/new">
              <Plus aria-hidden />
              Request a conference
            </Link>
          </Button>
        ) : undefined
      }
    >
      {conferences.length === 0 ? (
        <p className="glass text-muted-foreground rounded-2xl p-6 leading-relaxed">
          You have no conferences yet. Request one to get started: we send you an invoice, and once
          it is paid we approve it and your call for papers opens.
        </p>
      ) : (
        <ConferenceCards
          conferences={conferences}
          hrefOf={(conference) => `/organiser/conferences/${conference.id}`}
        />
      )}
    </RoleArea>
  );
}
