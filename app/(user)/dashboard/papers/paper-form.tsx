"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPaperAction, updatePaperAction } from "@/app/(user)/dashboard/papers/actions";
import { ChoiceGroup, Field, FormError, SelectField, TextAreaField } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";
import {
  ABSTRACT_MAX,
  countWords,
  OTHER,
  PAPER_TYPE_LABEL,
  PAPER_TYPES,
} from "@/lib/submissions/schema";

const INITIAL: FormState = {};

export type PaperFormValues = {
  title: string;
  authorNames: string;
  contactEmail: string;
  institution: string;
  topic: string;
  topicOther: string;
  disciplineId: string;
  disciplineOther: string;
  paperType: string;
  abstract: string;
};

const TYPE_DETAIL: Record<(typeof PAPER_TYPES)[number], string> = {
  QUANTITATIVE: "Numbers, measurement and statistics",
  QUALITATIVE: "Interviews, observation, texts",
  CONCEPTUAL: "Theory and argument, no new data",
  REVIEW: "A review of existing literature",
};

/**
 * A paper's details. With `paperId` it saves changes to an existing paper;
 * with `conferenceId` it starts a new draft for that conference.
 */
export function PaperForm({
  conferenceId,
  paperId,
  topics,
  disciplines,
  initial,
}: {
  conferenceId?: string;
  paperId?: string;
  topics: string[];
  disciplines: Array<{ id: string; name: string }>;
  initial: PaperFormValues;
}) {
  const [state, action, pending] = useActionState(
    paperId ? updatePaperAction : createPaperAction,
    INITIAL,
  );
  const value = (name: keyof PaperFormValues) => state.values?.[name] ?? initial[name];
  const [topic, setTopic] = useState(value("topic"));
  const [discipline, setDiscipline] = useState(value("disciplineId"));
  const [abstract, setAbstract] = useState(value("abstract"));

  return (
    <form action={action} className="space-y-10">
      <FormError state={state} />
      {paperId && <input type="hidden" name="paperId" value={paperId} />}
      {conferenceId && <input type="hidden" name="conferenceId" value={conferenceId} />}

      <fieldset className="min-w-0 space-y-5">
        <legend className="font-heading mb-1 text-xl font-medium">The paper</legend>
        <Field name="title" label="Title" state={state} defaultValue={value("title")} />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <SelectField
              name="topic"
              label="Topic"
              state={state}
              initial={value("topic")}
              onChange={(event) => setTopic(event.target.value)}
              options={[
                ...topics.map((option) => ({ value: option, label: option })),
                { value: OTHER, label: "Other" },
              ]}
            />
            {topic === OTHER && (
              <Field
                name="topicOther"
                label="Your topic"
                state={state}
                defaultValue={value("topicOther")}
              />
            )}
          </div>
          <div className="space-y-2">
            <SelectField
              name="disciplineId"
              label="Discipline or broad area of research"
              state={state}
              initial={value("disciplineId")}
              onChange={(event) => setDiscipline(event.target.value)}
              options={[
                ...disciplines.map((option) => ({ value: option.id, label: option.name })),
                { value: OTHER, label: "Other" },
              ]}
              hint="Reviewers are matched to papers in their discipline."
            />
            {discipline === OTHER && (
              <Field
                name="disciplineOther"
                label="Your area of research"
                state={state}
                defaultValue={value("disciplineOther")}
              />
            )}
          </div>
        </div>

        <ChoiceGroup
          name="paperType"
          legend="Type of paper"
          state={state}
          initial={value("paperType")}
          columns={4}
          options={PAPER_TYPES.map((type) => ({
            value: type,
            label: PAPER_TYPE_LABEL[type],
            detail: TYPE_DETAIL[type],
          }))}
        />

        <TextAreaField
          name="abstract"
          label="Abstract"
          rows={9}
          state={state}
          initial={value("abstract")}
          maxLength={ABSTRACT_MAX}
          onChange={(event) => setAbstract(event.target.value)}
          hint={`${countWords(abstract)} words · ${abstract.length.toLocaleString("en")} of ${ABSTRACT_MAX.toLocaleString("en")} characters`}
        />
      </fieldset>

      <fieldset className="min-w-0 space-y-5">
        <legend className="font-heading mb-1 text-xl font-medium">The authors</legend>
        <p className="text-muted-foreground -mt-2 text-sm leading-relaxed">
          These details are for the organisers. Reviewers do not see them when the conference uses
          blind review.
        </p>
        <TextAreaField
          name="authorNames"
          label="Author(s)"
          rows={2}
          state={state}
          initial={value("authorNames")}
          hint="Everyone who wrote the paper, in order, separated by commas."
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <Field
            name="contactEmail"
            label="Main author’s email"
            type="email"
            state={state}
            defaultValue={value("contactEmail")}
          />
          <Field
            name="institution"
            label="Main author’s institution"
            state={state}
            defaultValue={value("institution")}
          />
        </div>
      </fieldset>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-8">
        <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
          {pending ? "Saving…" : paperId ? "Save changes" : "Save and continue"}
        </Button>
        <Button asChild variant="ghost" size="lg" className="h-10 px-4 text-sm">
          <Link href={paperId ? `/dashboard/papers/${paperId}` : "/dashboard"}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
