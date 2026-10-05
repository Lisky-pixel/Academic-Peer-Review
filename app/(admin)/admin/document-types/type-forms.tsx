"use client";

import { useActionState } from "react";
import {
  createDocumentTypeAction,
  setDocumentTypeActiveAction,
  updateDocumentTypeAction,
} from "@/app/(admin)/admin/document-types/actions";
import { Field, FormError, FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

/** Name and description of a document type: used to add one and to rename one. */
export function DocumentTypeForm({
  id,
  name = "",
  description = "",
  stacked = false,
}: {
  /** Present when editing an existing type. */
  id?: string;
  name?: string;
  description?: string;
  /** One field per line, for a narrow column. */
  stacked?: boolean;
}) {
  const [state, action, pending] = useActionState(
    id ? updateDocumentTypeAction : createDocumentTypeAction,
    INITIAL,
  );

  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      {state.success && <FormMessage tone="success">Saved.</FormMessage>}
      {id && <input type="hidden" name="id" value={id} />}
      <div
        className={
          stacked
            ? "space-y-4"
            : "grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        }
      >
        <Field
          name="name"
          label="Name"
          placeholder="e.g. Grant Application"
          maxLength={60}
          state={state}
          defaultValue={state.values?.name ?? name}
        />
        <Field
          name="description"
          label="Description"
          placeholder="One line shown to authors choosing a type"
          maxLength={200}
          required={false}
          state={state}
          defaultValue={state.values?.description ?? description}
        />
      </div>
      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        {pending ? "Saving…" : id ? "Save" : "Add document type"}
      </Button>
    </form>
  );
}

/** Offers a type on the submission form, or withdraws it. */
export function ActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, action, pending] = useActionState(setDocumentTypeActiveAction, INITIAL);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!isActive)} />
      <p className="text-muted-foreground text-sm leading-relaxed">
        {isActive
          ? "Authors can choose this type when they submit."
          : "Authors can no longer choose this type. Submissions already made are unaffected."}
      </p>
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        {isActive ? "Withdraw from the submission form" : "Offer it again"}
      </Button>
    </form>
  );
}
