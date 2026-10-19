"use client";

import { BadgeCheck, Save } from "lucide-react";
import { useActionState } from "react";
import {
  declineConferenceAction,
  markInvoicePaidAction,
  savePaymentInstructionsAction,
} from "@/app/(admin)/admin/billing/actions";
import { Field, FormError, FormMessage, TextAreaField } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

export function PaymentInstructionsForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(savePaymentInstructionsAction, INITIAL);
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      {state.success && (
        <FormMessage tone="success">Saved. New invoices use this text.</FormMessage>
      )}
      <TextAreaField
        name="instructions"
        label="How organisers should pay"
        rows={6}
        state={state}
        initial={initial}
        required
        hint="Shown on every invoice and in the invoice email. For example your bank name, account name and number, or a mobile money number. Leave a blank line between paragraphs."
      />
      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        <Save aria-hidden />
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function MarkPaidForm({
  invoiceId,
  conferenceId,
  today,
}: {
  invoiceId: string;
  conferenceId: string;
  today: string;
}) {
  const [state, action, pending] = useActionState(markInvoicePaidAction, INITIAL);
  if (state.success) {
    return (
      <FormMessage tone="success">
        Marked paid. Receipt {state.values?.receipt} has been emailed to the organisers.
      </FormMessage>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field
          name="paidAt"
          label="Paid on"
          type="date"
          state={state}
          defaultValue={state.values?.paidAt ?? today}
          id={`paidAt-${invoiceId}`}
        />
        <Field
          name="reference"
          label="Their reference (optional)"
          required={false}
          state={state}
          defaultValue={state.values?.reference}
          id={`reference-${invoiceId}`}
        />
      </div>
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        <BadgeCheck aria-hidden />
        {pending ? "Saving…" : "Mark paid and send receipt"}
      </Button>
    </form>
  );
}

export function DeclineRequestForm({ conferenceId }: { conferenceId: string }) {
  const [state, action, pending] = useActionState(declineConferenceAction, INITIAL);
  if (state.success)
    return <FormMessage tone="success">Declined. The organiser has been told.</FormMessage>;
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        Decline this request
      </summary>
      <form action={action} className="border-border mt-3 space-y-3 rounded-xl border p-4">
        <FormError state={state} />
        <input type="hidden" name="conferenceId" value={conferenceId} />
        <TextAreaField
          name="reason"
          label="Reason, sent to the organiser"
          rows={3}
          state={state}
          required
        />
        <Button type="submit" variant="destructive" size="lg" disabled={pending}>
          {pending ? "Declining…" : "Decline request"}
        </Button>
      </form>
    </details>
  );
}
