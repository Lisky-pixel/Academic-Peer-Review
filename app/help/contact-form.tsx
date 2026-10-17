"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";
import { contactAction } from "@/app/help/actions";
import { Field, FormError, FormMessage, SelectField, TextAreaField } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

export function ContactForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(contactAction, INITIAL);

  if (state.success) {
    return (
      <FormMessage tone="success">
        Thank you. Your message has been sent, and we will reply by email.
      </FormMessage>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field
          name="name"
          label="Your name"
          autoComplete="name"
          state={state}
          defaultValue={state.values?.name ?? name}
        />
        <Field
          name="email"
          label="Your email"
          type="email"
          autoComplete="email"
          state={state}
          defaultValue={state.values?.email ?? email}
        />
      </div>
      <SelectField
        name="topic"
        label="What is it about?"
        state={state}
        options={[
          { value: "account", label: "Signing in or my account" },
          { value: "submitting", label: "Submitting a paper" },
          { value: "reviewing", label: "Reviewing" },
          { value: "organising", label: "Running a conference" },
          { value: "other", label: "Something else" },
        ]}
      />
      <TextAreaField name="message" label="Your message" rows={6} state={state} required />
      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        <Send aria-hidden />
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
