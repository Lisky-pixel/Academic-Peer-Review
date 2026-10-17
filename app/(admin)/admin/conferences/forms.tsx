"use client";

import { Receipt, UserPlus } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import {
  addOrganiserAction,
  inviteOrganiserAction,
  recordPaymentAction,
  saveConferenceAction,
} from "@/app/(admin)/admin/conferences/actions";
import {
  ChoiceGroup,
  CONTROL,
  Field,
  FormError,
  FormMessage,
  SelectField,
  TextAreaField,
} from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";
import { CURRENCIES } from "@/lib/conferences/schema";

const INITIAL: FormState = {};

export type ConferenceFormValues = {
  name: string;
  description: string;
  venue: string;
  startsOn: string;
  endsOn: string;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  reviewDeadline: string;
  reviewersPerPaper: string;
  maxPapersPerReviewer: string;
  doubleBlind: string;
  submissionFormat: string;
  topics: string;
  packageName: string;
  submissionLimit: string;
};

/** Creates a conference, or, with `conferenceId`, changes its settings. */
export function ConferenceForm({
  conferenceId,
  initial,
}: {
  conferenceId?: string;
  initial: ConferenceFormValues;
}) {
  const [state, action, pending] = useActionState(saveConferenceAction, INITIAL);
  const value = (name: keyof ConferenceFormValues) => state.values?.[name] ?? initial[name];

  return (
    <form action={action} className="space-y-10">
      <FormError state={state} />
      {state.success && <FormMessage tone="success">Settings saved.</FormMessage>}
      {conferenceId && <input type="hidden" name="conferenceId" value={conferenceId} />}

      <fieldset className="min-w-0 space-y-5">
        <legend className="font-heading mb-1 text-xl font-medium">The conference</legend>
        <Field name="name" label="Name" state={state} defaultValue={value("name")} />
        <TextAreaField
          name="description"
          label="Description (optional)"
          rows={3}
          required={false}
          state={state}
          initial={value("description")}
          hint="Shown to people deciding whether to submit."
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-3">
          <Field
            name="venue"
            label="Venue (optional)"
            required={false}
            state={state}
            defaultValue={value("venue")}
          />
          <Field
            name="startsOn"
            label="Starts (optional)"
            type="date"
            required={false}
            state={state}
            defaultValue={value("startsOn")}
          />
          <Field
            name="endsOn"
            label="Ends (optional)"
            type="date"
            required={false}
            state={state}
            defaultValue={value("endsOn")}
          />
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-5">
        <legend className="font-heading mb-1 text-xl font-medium">Call for papers</legend>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-3">
          <Field
            name="submissionsOpenAt"
            label="Opens"
            type="date"
            state={state}
            defaultValue={value("submissionsOpenAt")}
          />
          <Field
            name="submissionsCloseAt"
            label="Closes"
            type="date"
            state={state}
            defaultValue={value("submissionsCloseAt")}
            hint="Reviewers are matched automatically after this date."
          />
          <Field
            name="reviewDeadline"
            label="Reviews due"
            type="date"
            state={state}
            defaultValue={value("reviewDeadline")}
            hint="Reminders go 7, 3 and 1 days before."
          />
        </div>
        <TextAreaField
          name="topics"
          label="Topics"
          rows={6}
          state={state}
          initial={value("topics")}
          hint="One per line. Submitters choose from these, or Other."
        />
        <ChoiceGroup
          name="submissionFormat"
          legend="What do authors submit?"
          state={state}
          initial={value("submissionFormat")}
          options={[
            { value: "FULL_PAPER", label: "Full paper", detail: "A file is required." },
            {
              value: "ABSTRACT_ONLY",
              label: "Abstract",
              detail: "Reviewed on the abstract; a file is optional.",
            },
          ]}
        />
      </fieldset>

      <fieldset className="min-w-0 space-y-5">
        <legend className="font-heading mb-1 text-xl font-medium">Review</legend>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <SelectField
            name="reviewersPerPaper"
            label="Reviewers per paper"
            state={state}
            initial={value("reviewersPerPaper")}
            options={["1", "2", "3"].map((n) => ({ value: n, label: n }))}
            hint="If they disagree, one more is added automatically."
          />
          <SelectField
            name="maxPapersPerReviewer"
            label="Most papers one reviewer gets"
            state={state}
            initial={value("maxPapersPerReviewer")}
            options={["2", "3", "4", "5"].map((n) => ({ value: n, label: n }))}
          />
        </div>
        <ChoiceGroup
          name="doubleBlind"
          legend="Anonymity"
          state={state}
          initial={value("doubleBlind")}
          options={[
            {
              value: "yes",
              label: "Double-blind",
              detail: "Reviewers do not see who wrote the paper.",
            },
            {
              value: "no",
              label: "Single-blind",
              detail: "Reviewers see the authors. Reviewers stay anonymous either way.",
            },
          ]}
        />
      </fieldset>

      <fieldset className="min-w-0 space-y-5">
        <legend className="font-heading mb-1 text-xl font-medium">Package</legend>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <Field
            name="packageName"
            label="Package (optional)"
            required={false}
            state={state}
            defaultValue={value("packageName")}
            placeholder="e.g. Standard"
          />
          <Field
            name="submissionLimit"
            label="Paper limit (optional)"
            type="number"
            min={1}
            required={false}
            state={state}
            defaultValue={value("submissionLimit")}
            hint="The most papers this conference may receive. Empty means no limit."
          />
        </div>
      </fieldset>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-8">
        <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
          {pending ? "Saving…" : conferenceId ? "Save settings" : "Create conference"}
        </Button>
        <Button asChild variant="ghost" size="lg" className="h-10 px-4 text-sm">
          <Link href="/admin">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

/** Adds an existing organiser account, or invites a new one by email. */
export function OrganiserForms({
  conferenceId,
  organisers,
}: {
  conferenceId: string;
  organisers: Array<{ id: string; name: string; email: string }>;
}) {
  const [addState, add, adding] = useActionState(addOrganiserAction, INITIAL);
  const [inviteState, invite, inviting] = useActionState(inviteOrganiserAction, INITIAL);
  const inviteValues = inviteState.success ? {} : (inviteState.values ?? {});

  return (
    <div className="space-y-6">
      {organisers.length > 0 && (
        <form action={add} className="space-y-3">
          <FormError state={addState} />
          <input type="hidden" name="conferenceId" value={conferenceId} />
          <div className="space-y-2">
            <Label htmlFor="organiser-user">Add an existing organiser</Label>
            <div className="flex flex-wrap gap-2">
              <select
                id="organiser-user"
                name="userId"
                required
                defaultValue=""
                className={`${CONTROL} h-10 min-w-0 flex-1 basis-56`}
              >
                <option value="" disabled>
                  Choose one
                </option>
                {organisers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} ({person.email})
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="lg" className="h-10" disabled={adding}>
                Add
              </Button>
            </div>
          </div>
        </form>
      )}

      <form action={invite} className="space-y-3">
        <FormError state={inviteState} />
        {inviteState.success && (
          <FormMessage tone="success">
            Invitation sent to {inviteState.values?.email}. They are already attached to this
            conference.
          </FormMessage>
        )}
        <input type="hidden" name="conferenceId" value={conferenceId} />
        <p className="text-sm font-medium">Invite a new organiser</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <Field
            name="name"
            label="Name"
            state={inviteState}
            defaultValue={inviteValues.name}
            id="organiser-name"
          />
          <Field
            name="email"
            label="Email"
            type="email"
            state={inviteState}
            defaultValue={inviteValues.email}
            id="organiser-email"
          />
        </div>
        <Button type="submit" variant="outline" size="lg" disabled={inviting}>
          <UserPlus aria-hidden />
          {inviting ? "Sending…" : "Send invitation"}
        </Button>
      </form>
    </div>
  );
}

/** Records a payment and emails the organisers a receipt. */
export function PaymentForm({ conferenceId, today }: { conferenceId: string; today: string }) {
  const [state, action, pending] = useActionState(recordPaymentAction, INITIAL);
  const values = state.success ? {} : (state.values ?? {});

  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      {state.success && (
        <FormMessage tone="success">
          Payment recorded. Receipt {state.values?.receipt} has been emailed to the organisers.
        </FormMessage>
      )}
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field
          name="amount"
          label="Amount"
          inputMode="decimal"
          state={state}
          defaultValue={values.amount}
          placeholder="250000"
        />
        <SelectField
          name="currency"
          label="Currency"
          state={state}
          initial={values.currency ?? "NGN"}
          options={CURRENCIES.map((code) => ({ value: code, label: code }))}
        />
        <Field
          name="paidAt"
          label="Paid on"
          type="date"
          state={state}
          defaultValue={values.paidAt ?? today}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field
          name="description"
          label="For"
          state={state}
          defaultValue={values.description}
          placeholder="Standard package, 2026 edition"
        />
        <Field
          name="reference"
          label="Their reference (optional)"
          required={false}
          state={state}
          defaultValue={values.reference}
          placeholder="Bank transfer reference"
        />
      </div>
      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        <Receipt aria-hidden />
        {pending ? "Recording…" : "Record payment and send receipt"}
      </Button>
    </form>
  );
}
