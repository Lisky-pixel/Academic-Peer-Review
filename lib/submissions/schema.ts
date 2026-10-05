import { z } from "zod";

/** Trimmed free text that is stored as null when left empty. */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((value) => value || null);

/**
 * A deadline arrives from a date input as "YYYY-MM-DD". It is stored as the
 * end of that day in UTC, so "due on the 14th" stays the 14th wherever it is
 * read, and must be in the future.
 */
const deadline = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    const date = new Date(`${value}T23:59:59.000Z`);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    if (date.getTime() <= Date.now()) {
      ctx.addIssue({ code: "custom", message: "Choose a date in the future." });
      return z.NEVER;
    }
    return date;
  });

export const submissionDetailsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give your document a title.")
    .max(200, "Keep the title under 200 characters."),
  documentTypeId: z.uuid("Choose what kind of document this is."),
  purpose: optionalText(500, "Keep this under 500 characters."),
  description: optionalText(2000, "Keep this under 2,000 characters."),
  instructions: optionalText(4000, "Keep this under 4,000 characters."),
  focusAreas: optionalText(2000, "Keep this under 2,000 characters."),
  deadline,
});

export type SubmissionDetails = z.infer<typeof submissionDetailsSchema>;

/** Tomorrow as a date-input value: the earliest deadline a form may offer. */
export function earliestDeadlineInput(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

/** The date-input value ("YYYY-MM-DD") for a stored deadline. */
export function deadlineInputValue(deadline: Date | string | null): string {
  if (!deadline) return "";
  return new Date(deadline).toISOString().slice(0, 10);
}
