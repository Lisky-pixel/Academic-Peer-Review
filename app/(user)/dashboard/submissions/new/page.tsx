import type { Metadata } from "next";
import { BackLink } from "@/app/(user)/dashboard/submissions/back-link";
import { SubmissionForm } from "@/app/(user)/dashboard/submissions/submission-form";
import { RoleArea } from "@/components/role-area";
import { requireRole } from "@/lib/auth/guards";
import { findDocumentTypes } from "@/lib/submissions";
import { earliestDeadlineInput } from "@/lib/submissions/schema";

export const metadata: Metadata = { title: "New submission" };

const EMPTY = {
  title: "",
  documentTypeId: "",
  purpose: "",
  description: "",
  instructions: "",
  focusAreas: "",
  deadline: "",
};

export default async function NewSubmissionPage() {
  const user = await requireRole("USER");
  const documentTypes = await findDocumentTypes();

  return (
    <RoleArea
      user={user}
      eyebrow={<BackLink href="/dashboard">Your submissions</BackLink>}
      title="New submission"
      description="Tell us about the document first. You will upload the file on the next step, and nothing is sent until you choose to submit."
      current="/dashboard"
    >
      <div className="max-w-2xl">
        <SubmissionForm
          documentTypes={documentTypes.map(({ id, name }) => ({ id, name }))}
          initial={EMPTY}
          minDeadline={earliestDeadlineInput()}
        />
      </div>
    </RoleArea>
  );
}
