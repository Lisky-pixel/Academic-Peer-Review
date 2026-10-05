import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocumentTypeForm } from "@/app/(admin)/admin/document-types/type-forms";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { findDocumentTypesForAdmin } from "@/lib/admin/document-types";
import { requireRole } from "@/lib/auth/guards";
import { toDocumentTypeListDTO } from "@/lib/dto/admin";

export const metadata: Metadata = { title: "Document types" };

export default async function DocumentTypesPage() {
  const user = await requireRole("ADMIN");
  const types = (await findDocumentTypesForAdmin()).map(toDocumentTypeListDTO);

  return (
    <RoleArea
      user={user}
      title="Document types"
      description="The kinds of document authors can submit. Each has its own review template: the criteria a reviewer scores it against."
      current="/admin/document-types"
    >
      <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-2xl border">
        {types.map((type) => (
          <li key={type.id}>
            <Link
              href={`/admin/document-types/${type.id}`}
              className="hover:bg-muted/60 focus-visible:bg-muted/60 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors outline-none sm:px-6"
            >
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <p className="truncate font-medium">{type.name}</p>
                {type.description && (
                  <p className="text-muted-foreground truncate text-sm">{type.description}</p>
                )}
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">
                {type.criteriaCount} criteria
                {type.templateVersion !== null && ` · version ${type.templateVersion}`}
                {` · ${type.submissions} submission${type.submissions === 1 ? "" : "s"}`}
              </p>
              <StatusPill tone={type.isActive ? "success" : "muted"}>
                {type.isActive ? "On offer" : "Withdrawn"}
              </StatusPill>
              <ChevronRight aria-hidden className="text-muted-foreground hidden size-4 sm:block" />
            </Link>
          </li>
        ))}
      </ul>

      <section className="border-border bg-card rounded-2xl border p-6">
        <h2 className="font-heading text-xl font-medium">Add a document type</h2>
        <p className="text-muted-foreground mt-1 mb-5 text-sm leading-relaxed">
          It starts with a basic template of four criteria, which you can then change.
        </p>
        <DocumentTypeForm />
      </section>
    </RoleArea>
  );
}
