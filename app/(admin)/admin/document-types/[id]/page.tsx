import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/app/(admin)/admin/document-types/[id]/template-editor";
import { ActiveToggle, DocumentTypeForm } from "@/app/(admin)/admin/document-types/type-forms";
import { BackLink } from "@/components/back-link";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { findDocumentTypeDetail } from "@/lib/admin/document-types";
import { requireRole } from "@/lib/auth/guards";
import { toDocumentTypeDetailDTO } from "@/lib/dto/admin";
import { formatDate, isUuid } from "@/lib/format";

export const metadata: Metadata = { title: "Document type" };

const INPUT_TYPE_LABEL = {
  BOTH: "score and comment",
  RATING: "score only",
  TEXT: "written answer",
} as const;

export default async function DocumentTypePage({
  params,
}: PageProps<"/admin/document-types/[id]">) {
  const user = await requireRole("ADMIN");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const record = await findDocumentTypeDetail(id);
  if (!record) notFound();
  const type = toDocumentTypeDetailDTO(record);
  const earlier = type.versions.filter((version) => !version.isCurrent);

  return (
    <RoleArea
      user={user}
      eyebrow={<BackLink href="/admin/document-types">Document types</BackLink>}
      title={type.name}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusPill tone={type.isActive ? "success" : "muted"}>
            {type.isActive ? "On offer" : "Withdrawn"}
          </StatusPill>
          {type.current && <span>Template version {type.current.version}</span>}
        </span>
      }
      current="/admin/document-types"
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-5">
          <div>
            <h2 className="font-heading text-xl font-medium">Review template</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              What a reviewer is asked about a {type.name.toLowerCase()}, in order. Every score is
              out of five.
            </p>
          </div>
          <TemplateEditor
            documentTypeId={type.id}
            initial={type.current?.criteria ?? []}
            currentVersion={type.current?.version ?? null}
          />
        </section>

        <div className="space-y-12">
          <section className="space-y-4">
            <h2 className="font-heading text-xl font-medium">Name and description</h2>
            <DocumentTypeForm
              id={type.id}
              name={type.name}
              description={type.description ?? ""}
              stacked
            />
          </section>

          <section className="space-y-4">
            <h2 className="font-heading text-xl font-medium">Availability</h2>
            <ActiveToggle id={type.id} isActive={type.isActive} />
          </section>

          <section className="space-y-4">
            <h2 className="font-heading text-xl font-medium">Earlier versions</h2>
            {earlier.length === 0 ? (
              <p className="text-muted-foreground text-sm leading-relaxed">
                This template has not been changed since it was created.
              </p>
            ) : (
              <ol className="space-y-3">
                {earlier.map((version) => (
                  <li key={version.id}>
                    <details className="border-border rounded-xl border px-4 py-3 text-sm">
                      <summary className="cursor-pointer">
                        <span className="font-medium">Version {version.version}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {formatDate(version.publishedAt)} · {version.reviews} review
                          {version.reviews === 1 ? "" : "s"}
                        </span>
                      </summary>
                      <ol className="text-muted-foreground mt-3 list-decimal space-y-1 pl-5">
                        {version.criteria.map((criterion) => (
                          <li key={criterion.label}>
                            <span className="text-foreground">{criterion.label}</span> (
                            {INPUT_TYPE_LABEL[criterion.inputType]}
                            {criterion.required ? "" : ", optional"})
                          </li>
                        ))}
                      </ol>
                    </details>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-muted-foreground text-xs leading-relaxed">
              Earlier versions are kept because reviews written against them still show those
              criteria.
            </p>
          </section>
        </div>
      </div>
    </RoleArea>
  );
}
