import { z } from "zod";

/**
 * The shape of a review template's criteria, as an administrator edits them.
 * Pure, so the same rules run in the browser's editor and on the server.
 */

export const MAX_CRITERIA = 20;
/** Every rating is out of five. One scale keeps scores comparable. */
export const RATING_SCALE = 5;

export const criterionSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, "Give each criterion a name.")
    .max(100, "Keep criterion names under 100 characters."),
  helpText: z
    .string()
    .trim()
    .max(300, "Keep guidance under 300 characters.")
    .transform((value) => value || null),
  inputType: z.enum(["RATING", "TEXT", "BOTH"]),
  required: z.boolean(),
});

export type CriterionInput = z.infer<typeof criterionSchema>;

export const criteriaSchema = z
  .array(criterionSchema)
  .min(1, "A template needs at least one criterion.")
  .max(MAX_CRITERIA, `A template can have at most ${MAX_CRITERIA} criteria.`)
  .superRefine((criteria, ctx) => {
    // Reviews are displayed by criterion name, so two with the same name
    // would be indistinguishable to the author reading them.
    const seen = new Set<string>();
    criteria.forEach((criterion, index) => {
      const key = criterion.label.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "label"],
          message: `“${criterion.label}” appears twice. Each criterion needs its own name.`,
        });
      }
      seen.add(key);
    });
    if (!criteria.some((criterion) => criterion.required)) {
      ctx.addIssue({ code: "custom", message: "At least one criterion must be required." });
    }
  });

/** Whether two criteria lists are the same template, order included. */
export function sameCriteria(
  a: Array<{ label: string; helpText: string | null; inputType: string; required: boolean }>,
  b: Array<{ label: string; helpText: string | null; inputType: string; required: boolean }>,
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (criterion, index) =>
        criterion.label === b[index]!.label &&
        (criterion.helpText ?? null) === (b[index]!.helpText ?? null) &&
        criterion.inputType === b[index]!.inputType &&
        criterion.required === b[index]!.required,
    )
  );
}

/** "Cover Letter (EU)" → "cover-letter-eu" */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const documentTypeSchema = z.object({
  name: z.string().trim().min(2, "Give the document type a name.").max(60),
  description: z
    .string()
    .trim()
    .max(200, "Keep the description under 200 characters.")
    .transform((value) => value || null),
});

/** What a brand-new document type starts with, until an admin edits it. */
export const STARTER_CRITERIA: CriterionInput[] = [
  {
    label: "Grammar and mechanics",
    helpText: "Spelling, punctuation, agreement, and sentence-level correctness.",
    inputType: "BOTH",
    required: true,
  },
  {
    label: "Clarity",
    helpText: "Is each sentence easy to follow on a first read?",
    inputType: "BOTH",
    required: true,
  },
  {
    label: "Structure",
    helpText: "Does the piece flow in a logical order, with paragraphs that earn their place?",
    inputType: "BOTH",
    required: true,
  },
  {
    label: "Overall feedback",
    helpText: "Your summary for the author: what works, and the highest-impact things to change.",
    inputType: "TEXT",
    required: true,
  },
];
