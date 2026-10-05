import type { SubmissionStatus } from "@/lib/generated/prisma/client";
import type { AdminSubmissionRecord, OwnSubmissionRecord } from "@/lib/submissions";
import { type AuthorStage, authorStage } from "@/lib/submissions/stage";
import { AUTHOR_CANCELLABLE } from "@/lib/workflow/transitions";

/**
 * A submission as its author sees it.
 *
 * THE ANONYMITY BOUNDARY. This type has no reviewer field, no assignment
 * field and no internal status — only the author-facing `stage`. Because the
 * shape itself cannot carry a reviewer's identity, adding one by accident is
 * a compile error, not a leak. Do not add a field here without asking whether
 * it could identify who reviewed the work.
 */
export type UserSubmissionDTO = {
  id: string;
  reference: string;
  title: string;
  documentType: { id: string; name: string };
  purpose: string | null;
  description: string | null;
  instructions: string | null;
  focusAreas: string | null;
  deadline: string | null;
  stage: AuthorStage;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  /** The author's own uploaded document. */
  document: { filename: string; sizeBytes: number; uploadedAt: string } | null;
  /** Details and document can still be changed. */
  canEdit: boolean;
  /** A document is attached and it has not been submitted yet. */
  canSubmit: boolean;
  /** The author may still withdraw it. */
  canWithdraw: boolean;
};

export function toUserSubmissionDTO(record: OwnSubmissionRecord): UserSubmissionDTO {
  const file = record.files[0];
  const isDraft = record.status === "DRAFT";

  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    documentType: { id: record.documentType.id, name: record.documentType.name },
    purpose: record.purpose,
    description: record.description,
    instructions: record.instructions,
    focusAreas: record.focusAreas,
    deadline: record.deadline?.toISOString() ?? null,
    stage: authorStage(record.status),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
    document: file
      ? {
          filename: file.originalFilename,
          sizeBytes: file.sizeBytes,
          uploadedAt: file.createdAt.toISOString(),
        }
      : null,
    canEdit: isDraft,
    canSubmit: isDraft && Boolean(file),
    canWithdraw: AUTHOR_CANCELLABLE.includes(record.status),
  };
}

/** A submission row in the administrator's list, with the real status. */
export type AdminSubmissionDTO = {
  id: string;
  reference: string;
  title: string;
  documentType: { id: string; name: string };
  status: SubmissionStatus;
  author: { id: string; name: string; email: string };
  /** Who currently holds it. Administrators only — never shown to the author. */
  reviewerName: string | null;
  deadline: string | null;
  createdAt: string;
  submittedAt: string | null;
};

export function toAdminSubmissionDTO(record: AdminSubmissionRecord): AdminSubmissionDTO {
  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    documentType: { id: record.documentType.id, name: record.documentType.name },
    status: record.status,
    author: { id: record.author.id, name: record.author.name, email: record.author.email },
    reviewerName: record.assignments[0]?.reviewer.name ?? null,
    deadline: record.deadline?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
  };
}
