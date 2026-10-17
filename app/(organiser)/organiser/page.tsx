import type { Metadata } from "next";
import { ConferenceCards } from "@/components/conference-cards";
import { RoleArea } from "@/components/role-area";
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
    >
      {conferences.length === 0 ? (
        <p className="glass text-muted-foreground rounded-2xl p-6 leading-relaxed">
          You have not been added to a conference yet. The platform administrator sets up each
          conference and adds its organisers.
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
