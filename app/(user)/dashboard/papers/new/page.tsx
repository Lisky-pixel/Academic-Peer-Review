import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaperForm } from "@/app/(user)/dashboard/papers/paper-form";
import { BackLink } from "@/components/back-link";
import { RoleArea } from "@/components/role-area";
import { requireRole } from "@/lib/auth/guards";
import { findOwnInstitution } from "@/lib/conferences/pool";
import { formatDate, isUuid } from "@/lib/format";
import { findConferenceForSubmitting, findDisciplines, isOpenForPapers } from "@/lib/submissions";

export const metadata: Metadata = { title: "Submit a paper" };

export default async function NewPaperPage({ searchParams }: PageProps<"/dashboard/papers/new">) {
  const user = await requireRole("USER", "REVIEWER");
  const { conference: conferenceId } = await searchParams;
  if (typeof conferenceId !== "string" || !isUuid(conferenceId)) notFound();

  const [conference, disciplines, me] = await Promise.all([
    findConferenceForSubmitting(conferenceId),
    findDisciplines(),
    findOwnInstitution(user.id),
  ]);
  if (!conference || !isOpenForPapers(conference)) notFound();

  return (
    <RoleArea
      user={user}
      title="Submit a paper"
      eyebrow={<BackLink href="/dashboard">My papers</BackLink>}
      description={
        <>
          To <span className="text-foreground font-medium">{conference.name}</span>. The call closes
          on {formatDate(conference.submissionsCloseAt)}.{" "}
          {conference.submissionFormat === "FULL_PAPER"
            ? "You will attach the full paper on the next step."
            : "This conference reviews abstracts; attaching a file is optional."}
        </>
      }
    >
      <div className="glass rounded-3xl p-5 sm:p-8">
        <PaperForm
          conferenceId={conference.id}
          topics={conference.topics}
          disciplines={disciplines}
          initial={{
            title: "",
            authorNames: user.name,
            contactEmail: user.email,
            institution: me,
            topic: "",
            topicOther: "",
            disciplineId: "",
            disciplineOther: "",
            paperType: "",
            abstract: "",
          }}
        />
      </div>
    </RoleArea>
  );
}
