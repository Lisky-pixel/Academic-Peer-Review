import { z } from "zod";

/** A date input ("YYYY-MM-DD") as the end of that day in UTC. */
const endOfDay = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter ${label}.`)
    .transform((value) => new Date(`${value}T23:59:59.000Z`));

/** A date input as the start of that day in UTC. */
const startOfDay = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter ${label}.`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`));

const optionalDay = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return new Date(`${value}T00:00:00.000Z`);
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .transform((value) => value || null);

export const conferenceSchema = z
  .object({
    name: z.string().trim().min(3, "Give the conference a name.").max(200),
    description: optionalText(4000),
    venue: optionalText(300),
    startsOn: optionalDay,
    endsOn: optionalDay,
    submissionsOpenAt: startOfDay("the date the call for papers opens"),
    submissionsCloseAt: endOfDay("the closing date for papers"),
    reviewDeadline: endOfDay("the date reviews are due"),
    reviewersPerPaper: z.coerce
      .number()
      .int()
      .min(1, "At least one reviewer per paper.")
      .max(3, "At most three reviewers per paper."),
    maxPapersPerReviewer: z.coerce
      .number()
      .int()
      .min(2, "Between 2 and 5 papers per reviewer.")
      .max(5, "Between 2 and 5 papers per reviewer."),
    doubleBlind: z.enum(["yes", "no"]).transform((value) => value === "yes"),
    submissionFormat: z.enum(["FULL_PAPER", "ABSTRACT_ONLY"]),
    topics: z
      .string()
      .transform((value) =>
        [
          ...new Set(
            value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          ),
        ].slice(0, 60),
      )
      .refine((topics) => topics.length > 0, "List at least one topic, one per line."),
    packageName: optionalText(100),
    submissionLimit: z
      .string()
      .trim()
      .transform((value, ctx) => {
        if (!value) return null;
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1) {
          ctx.addIssue({ code: "custom", message: "Enter a whole number, or leave it empty." });
          return z.NEVER;
        }
        return number;
      }),
  })
  .superRefine((value, ctx) => {
    if (value.submissionsCloseAt <= value.submissionsOpenAt) {
      ctx.addIssue({
        code: "custom",
        path: ["submissionsCloseAt"],
        message: "The call must close after it opens.",
      });
    }
    if (value.reviewDeadline <= value.submissionsCloseAt) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewDeadline"],
        message: "Reviews must be due after the call for papers closes.",
      });
    }
    if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "It must end after it starts." });
    }
  });

export type ConferenceInput = z.infer<typeof conferenceSchema>;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "conference"
  );
}

/** "YYYY-MM-DD" for a date input, from a stored date. */
export function dateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export const CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD", "EUR", "GBP"] as const;

export const paymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter the amount, e.g. 250000 or 1500.50.")
    .transform((value) => Math.round(Number(value) * 100))
    .refine((value) => value > 0, "Enter an amount above zero."),
  currency: z.enum(CURRENCIES, "Choose the currency."),
  description: z.string().trim().min(3, "Say what the payment was for.").max(300),
  reference: optionalText(100),
  paidAt: startOfDay("the date it was paid"),
});

export type PaymentInput = z.infer<typeof paymentSchema>;

/** "NGN 250,000.00" */
export function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Suggested dates for a new conference: open today, close in six weeks, reviews due four weeks later. */
export function suggestedDates(now: Date = new Date()) {
  const day = 86_400_000;
  return {
    submissionsOpenAt: dateInputValue(now),
    submissionsCloseAt: dateInputValue(new Date(now.getTime() + 42 * day)),
    reviewDeadline: dateInputValue(new Date(now.getTime() + 70 * day)),
  };
}
