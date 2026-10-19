import type { Metadata } from "next";
import { requestConferenceAction } from "@/app/(organiser)/organiser/actions";
import { BackLink } from "@/components/back-link";
import { ConferenceForm } from "@/components/conference-forms";
import { RoleArea } from "@/components/role-area";
import { requireRole } from "@/lib/auth/guards";
import { suggestedDates } from "@/lib/conferences/schema";

export const metadata: Metadata = { title: "Request a conference" };

export default async function RequestConferencePage() {
  const user = await requireRole("ORGANISER");
  const dates = suggestedDates();

  return (
    <RoleArea
      user={user}
      title="Request a conference"
      eyebrow={<BackLink href="/organiser">Your conferences</BackLink>}
      description="Tell us about your conference. We email you an invoice straight away; once it is paid we approve the conference and your call for papers opens."
    >
      <div className="glass rounded-3xl p-5 sm:p-8">
        <ConferenceForm
          request={{ action: requestConferenceAction, cancelHref: "/organiser" }}
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
