import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PaperForm } from "@/app/(user)/dashboard/papers/paper-form";
import { BackLink } from "@/components/back-link";
import { RoleArea } from "@/components/role-area";
import { requireRole } from "@/lib/auth/guards";
import { toUserPaperDTO } from "@/lib/dto/submission";
import { isUuid } from "@/lib/format";
import { findDisciplines, findOwnPaper } from "@/lib/submissions";
import { OTHER } from "@/lib/submissions/schema";

export const metadata: Metadata = { title: "Edit paper" };

export default async function EditPaperPage({ params }: PageProps<"/dashboard/papers/[id]/edit">) {
  const user = await requireRole("USER", "REVIEWER");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [record, disciplines] = await Promise.all([findOwnPaper(user.id, id), findDisciplines()]);
  if (!record) notFound();
  const paper = toUserPaperDTO(record);
  if (!paper.canEdit) redirect(`/dashboard/papers/${id}`);

  return (
    <RoleArea
      user={user}
      title="Edit paper"
      eyebrow={<BackLink href={`/dashboard/papers/${id}`}>{paper.reference}</BackLink>}
      description="You can change your paper until it is sent to reviewers."
    >
      <div className="glass rounded-3xl p-5 sm:p-8">
        <PaperForm
          paperId={paper.id}
          topics={paper.conference.topics}
          disciplines={disciplines}
          initial={{
            title: paper.title,
            authorNames: paper.authorNames,
            contactEmail: paper.contactEmail,
            institution: paper.institution,
            topic: paper.topicListed ? paper.topic : OTHER,
            topicOther: paper.topicListed ? "" : paper.topic,
            disciplineId: paper.disciplineId ?? OTHER,
            disciplineOther: paper.disciplineOther ?? "",
            paperType: paper.paperType,
            abstract: paper.abstract,
          }}
        />
      </div>
    </RoleArea>
  );
}
