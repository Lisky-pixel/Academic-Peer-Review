import type { Metadata } from "next";
import { ConferenceForm } from "@/components/conference-forms";
import { BackLink } from "@/components/back-link";
import { RoleArea } from "@/components/role-area";
import { requireRole } from "@/lib/auth/guards";
import { suggestedDates } from "@/lib/conferences/schema";

export const metadata: Metadata = { title: "New conference" };

export default async function NewConferencePage() {
  const user = await requireRole("ADMIN");
  const dates = suggestedDates();

  return (
    <RoleArea
      user={user}
      title="New conference"
      eyebrow={<BackLink href="/admin">Conferences</BackLink>}
      description="Set the dates the organisers gave you. You can add the organisers on the next page."
    >
      <div className="glass rounded-3xl p-5 sm:p-8">
        <ConferenceForm
          initial={{
            name: "",
            description: "",
            venue: "",
            startsOn: "",
            endsOn: "",
            ...dates,
            reviewersPerPaper: "2",
            maxPapersPerReviewer: "4",
            doubleBlind: "yes",
            submissionFormat: "FULL_PAPER",
            topics: "",
            packageName: "",
            submissionLimit: "",
          }}
        />
      </div>
    </RoleArea>
  );
}
