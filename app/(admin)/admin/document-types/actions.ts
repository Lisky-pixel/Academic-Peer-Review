"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createDocumentType,
  publishTemplate,
  setDocumentTypeActive,
  updateDocumentType,
} from "@/lib/admin/document-types";
import { criteriaSchema, documentTypeSchema } from "@/lib/admin/template-schema";
import { requireRole } from "@/lib/auth/guards";
import { type FormState, zodFieldErrors } from "@/lib/auth/schemas";
import { isUuid } from "@/lib/format";

const NAME_TAKEN = "Another document type already has that name.";
const PATH = "/admin/document-types";

function refresh(id?: string) {
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
}

function typeFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
  };
}

export async function createDocumentTypeAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");

  const values = typeFields(formData);
  const parsed = documentTypeSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };

  const result = await createDocumentType(admin, parsed.data);
  if (!result.ok) return { values, fieldErrors: { name: [NAME_TAKEN] } };

  refresh();
  // Straight to its template, which is the next thing to look at.
  redirect(`${PATH}/${result.id}`);
}

export async function updateDocumentTypeAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");

  const values = typeFields(formData);
  const parsed = documentTypeSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
  if (!isUuid(id)) return { values, error: "That document type no longer exists." };

  const result = await updateDocumentType(admin, id, parsed.data);
  if (!result.ok) {
    return result.reason === "name_taken"
      ? { values, fieldErrors: { name: [NAME_TAKEN] } }
      : { values, error: "That document type no longer exists." };
  }

  refresh(id);
  return { success: true, values };
}

export async function setDocumentTypeActiveAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { error: "That document type no longer exists." };

  const result = await setDocumentTypeActive(admin, id, formData.get("active") === "true");
  if (!result.ok) {
    return {
      error:
        result.reason === "last_active"
          ? "This is the only document type on offer. Add or restore another before withdrawing it."
          : "That has already been changed. Reload to see where it stands.",
    };
  }

  refresh(id);
  return { success: true };
}

/** Publishes a new template version from the editor's list of criteria. */
export async function publishTemplateAction(
  documentTypeId: string,
  criteria: unknown,
): Promise<{ ok: boolean; message: string; issues?: string[] }> {
  const admin = await requireRole("ADMIN");
  if (!isUuid(documentTypeId)) {
    return { ok: false, message: "That document type no longer exists." };
  }

  const parsed = criteriaSchema.safeParse(criteria);
  if (!parsed.success) {
    return {
      ok: false,
      message: "The template could not be saved.",
      issues: [...new Set(parsed.error.issues.map((issue) => issue.message))],
    };
  }

  const result = await publishTemplate(admin, documentTypeId, parsed.data);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "changed_meanwhile"
          ? "Someone else saved this template at the same moment. Reload and try again."
          : "That document type no longer exists.",
    };
  }

  refresh(documentTypeId);
  return {
    ok: true,
    message: result.changed
      ? `Saved as version ${result.version}. Reviews already in progress keep the version they started with.`
      : "Nothing had changed, so no new version was made.",
  };
}
