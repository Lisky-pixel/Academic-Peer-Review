"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";
import { sendTestEmailAction } from "@/app/(admin)/admin/email/actions";
import { Field, FormError, FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const [state, action, pending] = useActionState(sendTestEmailAction, INITIAL);
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      {state.success && (
        <FormMessage tone="success">
          Sent to {state.values?.to}. If it does not arrive within a minute, check spam.
        </FormMessage>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <Field
            name="to"
            label="Send a test email to"
            type="email"
            state={state}
            defaultValue={state.values?.to ?? defaultTo}
          />
        </div>
        <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
          <Send aria-hidden />
          {pending ? "Sending…" : "Send test"}
        </Button>
      </div>
    </form>
  );
}
