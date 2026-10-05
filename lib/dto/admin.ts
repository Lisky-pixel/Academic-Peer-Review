import type { ActivityLogRecord } from "@/lib/admin/activity";
import type { DocumentTypeDetailRecord, DocumentTypeListRecord } from "@/lib/admin/document-types";
import type { AdminUserRecord } from "@/lib/admin/users";
import type { CriterionInputType, Role, UserStatus } from "@/lib/generated/prisma/client";

/** Administrator-only views of people, document types and the audit log. */

// ── People ─────────────────────────────────────────────────────────────────

export type AdminUserDTO = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  joinedAt: string;
  lastSeenAt: string | null;
  submissions: number;
  /** Reviews currently in this person's hands (reviewers only). */
  openReviews: number;
};

export function toAdminUserDTO(record: AdminUserRecord): AdminUserDTO {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    status: record.status,
    joinedAt: record.createdAt.toISOString(),
    lastSeenAt: record.sessions[0]?.lastUsedAt.toISOString() ?? null,
    submissions: record._count.submissions,
    openReviews: record.assignmentsToReview.length,
  };
}

export const ROLE_LABEL: Record<Role, string> = {
  USER: "Author",
  REVIEWER: "Reviewer",
  ADMIN: "Administrator",
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  UNVERIFIED: "Unconfirmed",
  SUSPENDED: "Suspended",
};

// ── Document types and templates ───────────────────────────────────────────

export type DocumentTypeListDTO = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  submissions: number;
  templateVersion: number | null;
  criteriaCount: number;
};

export function toDocumentTypeListDTO(record: DocumentTypeListRecord): DocumentTypeListDTO {
  const template = record.templates[0];
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    isActive: record.isActive,
    submissions: record._count.submissions,
    templateVersion: template?.version ?? null,
    criteriaCount: template?._count.criteria ?? 0,
  };
}

export type TemplateCriterionDTO = {
  label: string;
  helpText: string | null;
  inputType: CriterionInputType;
  required: boolean;
};

export type TemplateVersionDTO = {
  id: string;
  version: number;
  isCurrent: boolean;
  publishedAt: string;
  /** Reviews written against this version. They keep it for good. */
  reviews: number;
  criteria: TemplateCriterionDTO[];
};

export type DocumentTypeDetailDTO = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  current: TemplateVersionDTO | null;
  /** Every version, newest first, including the current one. */
  versions: TemplateVersionDTO[];
};

export function toDocumentTypeDetailDTO(record: DocumentTypeDetailRecord): DocumentTypeDetailDTO {
  const versions: TemplateVersionDTO[] = record.templates.map((template) => ({
    id: template.id,
    version: template.version,
    isCurrent: template.isActive === true,
    publishedAt: template.createdAt.toISOString(),
    reviews: template._count.reviews,
    criteria: template.criteria.map((criterion) => ({ ...criterion })),
  }));

  return {
    id: record.id,
    name: record.name,
    description: record.description,
    isActive: record.isActive,
    current: versions.find((version) => version.isCurrent) ?? null,
    versions,
  };
}

// ── Activity ───────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  "submission.create_draft": "Draft started",
  "submission.submit": "Submitted for review",
  "submission.assign": "Reviewer assigned",
  "submission.reassign": "Reassigned to another reviewer",
  "submission.accept": "Reviewer accepted",
  "submission.decline": "Reviewer declined",
  "submission.start_review": "Review started",
  "submission.submit_review": "Review submitted",
  "submission.request_revision": "Revision requested",
  "submission.resubmit_review": "Revised review submitted",
  "submission.approve": "Review approved",
  "submission.deliver": "Delivered to the author",
  "submission.cancel": "Cancelled",
  "submission.author_visibility": "Author visibility changed",
  "auth.login": "Signed in",
  "auth.registered": "Account confirmed",
  "auth.password_reset": "Password reset by email",
  "auth.password_changed": "Password changed",
  "auth.invite_sent": "Invitation sent",
  "auth.invite_cancelled": "Invitation cancelled",
  "auth.invite_accepted": "Invitation accepted",
  "user.suspended": "Account suspended",
  "user.reactivated": "Account reactivated",
  "document_type.created": "Document type added",
  "document_type.updated": "Document type renamed",
  "document_type.activated": "Document type offered again",
  "document_type.deactivated": "Document type withdrawn",
  "template.published": "Review template updated",
};

/** A readable name for a logged action; the raw name if it is a new one. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export type ActivityEntryDTO = {
  id: string;
  label: string;
  /** Who did it, named in full: this is the audit trail. */
  actor: string;
  /** What it was done to: a reference, a person, a document type. */
  subject: string | null;
  /** Where to read more, when the subject has a page. */
  href: string | null;
  detail: string | null;
  at: string;
};

export function toActivityEntryDTO(record: ActivityLogRecord): ActivityEntryDTO {
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};

  let detail: string | null = null;
  if (typeof metadata.reason === "string") detail = metadata.reason;
  else if (typeof metadata.version === "number") detail = `Version ${metadata.version}`;
  else if (typeof metadata.authorVisibleToReviewer === "boolean") {
    detail = metadata.authorVisibleToReviewer
      ? "The reviewer can now see who the author is."
      : "The author is now hidden from the reviewer.";
  }

  const href =
    record.subject === null
      ? null
      : record.entityType === "Submission"
        ? `/admin/submissions/${record.entityId}`
        : record.entityType === "DocumentType"
          ? `/admin/document-types/${record.entityId}`
          : null;

  return {
    id: record.id,
    label: actionLabel(record.action),
    actor: record.actor
      ? `${record.actor.name}${record.actorRole ? ` (${ROLE_LABEL[record.actorRole]})` : ""}`
      : "System",
    subject: record.subject,
    href,
    detail,
    at: record.createdAt.toISOString(),
  };
}
