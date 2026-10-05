import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { SubmissionForm } from "@/app/(user)/dashboard/submissions/submission-form";
import { RoleArea } from "@/components/role-area";
import { requireRole } from "@/lib/auth/guards";
import { toUserSubmissionDTO } from "@/lib/dto/submission";
import { isUuid } from "@/lib/format";
import { findDocumentTypes, findOwnSubmission } from "@/lib/submissions";
import { deadlineInputValue, earliestDeadlineInput } from "@/lib/submissions/schema";

export const metadata: Metadata = { title: "Edit submission" };

export default async function EditSubmissionPage({
  params,
}: PageProps<"/dashboard/submissions/[id]/edit">) {
  const user = await requireRole("USER");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const record = await findOwnSubmission(user.id, id);
  if (!record) notFound();
  const submission = toUserSubmissionDTO(record);
  // Once submitted, the details are what the reviewer was given.
  if (!submission.canEdit) redirect(`/dashboard/submissions/${id}`);

  const documentTypes = await findDocumentTypes();

  return (
    <RoleArea
      user={user}
      eyebrow={<BackLink href={`/dashboard/submissions/${id}`}>{submission.reference}</BackLink>}
      title="Edit details"
      current="/dashboard"
    >
      <div className="max-w-2xl">
        <SubmissionForm
          submissionId={id}
          documentTypes={documentTypes.map((type) => ({ id: type.id, name: type.name }))}
          initial={{
            title: submission.title,
            documentTypeId: submission.documentType.id,
            purpose: submission.purpose ?? "",
            description: submission.description ?? "",
            instructions: submission.instructions ?? "",
            focusAreas: submission.focusAreas ?? "",
            deadline: deadlineInputValue(submission.deadline),
          }}
          minDeadline={earliestDeadlineInput()}
        />
      </div>
    </RoleArea>
  );
}
