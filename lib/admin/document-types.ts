import {
  type CriterionInput,
  RATING_SCALE,
  sameCriteria,
  slugify,
  STARTER_CRITERIA,
} from "@/lib/admin/template-schema";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Document types and their review templates, for administrators.
 *
 * THE VERSIONING RULE. A template's criteria are never edited in place.
 * Saving a change publishes a new version and retires the old one; reviews
 * already written keep pointing at the version they were answered against.
 * Otherwise editing "Clarity" into "Tone" would silently rewrite what every
 * past reviewer was scoring. `publishTemplate` is the only function that
 * writes criteria, and it only ever inserts.
 */

function log(
  tx: Prisma.TransactionClient,
  admin: SessionUser,
  action: string,
  documentTypeId: string,
  metadata?: Prisma.InputJsonObject,
) {
  return tx.activityLog.create({
    data: {
      action,
      entityType: "DocumentType",
      entityId: documentTypeId,
      actorId: admin.id,
      actorRole: admin.role,
      metadata,
    },
  });
}

const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "P2002";

// ── Reading ────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  _count: { select: { submissions: true } },
  templates: {
    where: { isActive: true },
    select: { version: true, _count: { select: { criteria: true } } },
  },
} satisfies Prisma.DocumentTypeSelect;

export type DocumentTypeListRecord = Prisma.DocumentTypeGetPayload<{ select: typeof LIST_SELECT }>;

export function findDocumentTypesForAdmin(): Promise<DocumentTypeListRecord[]> {
  return db.documentType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: LIST_SELECT,
  });
}

const DETAIL_SELECT = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  templates: {
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      isActive: true,
      createdAt: true,
      _count: { select: { reviews: true } },
      criteria: {
        orderBy: { sortOrder: "asc" },
        select: { label: true, helpText: true, inputType: true, required: true },
      },
    },
  },
} satisfies Prisma.DocumentTypeSelect;

export type DocumentTypeDetailRecord = Prisma.DocumentTypeGetPayload<{
  select: typeof DETAIL_SELECT;
}>;

export function findDocumentTypeDetail(id: string): Promise<DocumentTypeDetailRecord | null> {
  return db.documentType.findUnique({ where: { id }, select: DETAIL_SELECT });
}

// ── Document types ─────────────────────────────────────────────────────────

function criteriaRows(criteria: CriterionInput[]) {
  return criteria.map((criterion, sortOrder) => ({
    ...criterion,
    maxRating: RATING_SCALE,
    sortOrder,
  }));
}

export type DocumentTypeResult =
  { ok: true; id: string } | { ok: false; reason: "name_taken" | "not_found" };

/**
 * Adds a document type, with a starter template so it is usable at once: a
 * type with no template could be submitted against but never reviewed.
 */
export async function createDocumentType(
  admin: SessionUser,
  input: { name: string; description: string | null },
): Promise<DocumentTypeResult> {
  const slug = slugify(input.name);
  if (!slug) return { ok: false, reason: "name_taken" };

  try {
    const id = await db.$transaction(async (tx) => {
      const last = await tx.documentType.aggregate({ _max: { sortOrder: true } });
      const created = await tx.documentType.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
          templates: {
            create: {
              name: `${input.name} review`,
              version: 1,
              isActive: true,
              criteria: { create: criteriaRows(STARTER_CRITERIA) },
            },
          },
        },
        select: { id: true },
      });
      await log(tx, admin, "document_type.created", created.id, { name: input.name });
      return created.id;
    });
    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name_taken" };
    throw error;
  }
}

/** Renames a type or changes its description. Its link (slug) never changes. */
export async function updateDocumentType(
  admin: SessionUser,
  id: string,
  input: { name: string; description: string | null },
): Promise<DocumentTypeResult> {
  try {
    return await db.$transaction(async (tx) => {
      const { count } = await tx.documentType.updateMany({ where: { id }, data: input });
      if (count !== 1) return { ok: false, reason: "not_found" } as const;
      await log(tx, admin, "document_type.updated", id, { name: input.name });
      return { ok: true, id } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name_taken" };
    throw error;
  }
}

/**
 * Offers or withdraws a type on the submission form. Withdrawing one leaves
 * existing submissions of that type untouched. The last active type cannot be
 * withdrawn, or authors would have nothing to choose.
 */
export async function setDocumentTypeActive(
  admin: SessionUser,
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "last_active" }> {
  return db.$transaction(async (tx) => {
    if (!active) {
      const others = await tx.documentType.count({ where: { isActive: true, id: { not: id } } });
      if (others === 0) return { ok: false, reason: "last_active" } as const;
    }
    const { count } = await tx.documentType.updateMany({
      where: { id, isActive: !active },
      data: { isActive: active },
    });
    if (count !== 1) return { ok: false, reason: "not_found" } as const;
    await log(tx, admin, active ? "document_type.activated" : "document_type.deactivated", id);
    return { ok: true } as const;
  });
}

// ── Templates ──────────────────────────────────────────────────────────────

export type PublishResult =
  | { ok: true; version: number; changed: boolean }
  | { ok: false; reason: "not_found" | "changed_meanwhile" };

/**
 * Publishes a new version of a type's template with the given criteria.
 *
 * If nothing differs from the current version, nothing is written. Otherwise
 * the current version is retired and a new one inserted, in one transaction;
 * the database's unique indexes on (type, version) and (type, isActive)
 * guarantee there is exactly one active version even if two administrators
 * save at the same moment — the second is told to reload.
 */
export async function publishTemplate(
  admin: SessionUser,
  documentTypeId: string,
  criteria: CriterionInput[],
): Promise<PublishResult> {
  try {
    return await db.$transaction(async (tx) => {
      const type = await tx.documentType.findUnique({
        where: { id: documentTypeId },
        select: {
          name: true,
          templates: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              version: true,
              isActive: true,
              criteria: {
                orderBy: { sortOrder: "asc" },
                select: { label: true, helpText: true, inputType: true, required: true },
              },
            },
          },
        },
      });
      if (!type) return { ok: false, reason: "not_found" } as const;

      const current = type.templates[0];
      if (current?.isActive && sameCriteria(current.criteria, criteria)) {
        return { ok: true, version: current.version, changed: false } as const;
      }

      // Retire first: (documentTypeId, isActive) is unique, so the new active
      // row cannot be inserted while the old one is still marked active.
      await tx.reviewTemplate.updateMany({
        where: { documentTypeId, isActive: true },
        data: { isActive: null },
      });
      const version = (current?.version ?? 0) + 1;
      await tx.reviewTemplate.create({
        data: {
          documentTypeId,
          name: `${type.name} review`,
          version,
          isActive: true,
          criteria: { create: criteriaRows(criteria) },
        },
      });
      await log(tx, admin, "template.published", documentTypeId, { version });
      return { ok: true, version, changed: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "changed_meanwhile" };
    throw error;
  }
}
