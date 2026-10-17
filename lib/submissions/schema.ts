import { z } from "zod";

/** What "Other" is sent as from a topic or discipline list. */
export const OTHER = "__other__";

export const PAPER_TYPES = ["QUANTITATIVE", "QUALITATIVE", "CONCEPTUAL", "REVIEW"] as const;

export const PAPER_TYPE_LABEL: Record<(typeof PAPER_TYPES)[number], string> = {
  QUANTITATIVE: "Quantitative",
  QUALITATIVE: "Qualitative",
  CONCEPTUAL: "Conceptual",
  REVIEW: "Review",
};

export const ABSTRACT_MAX = 5000;

const text = (min: number, max: number, empty: string, long: string) =>
  z.string().trim().min(min, empty).max(max, long);

/**
 * A paper's details as the form sends them. Topic and discipline arrive as a
 * choice from a list, or OTHER plus the typed value; `resolvePaperDetails`
 * turns that into what is stored.
 */
export const paperDetailsSchema = z
  .object({
    title: text(5, 300, "Give the paper its title.", "Keep the title under 300 characters."),
    authorNames: text(2, 1000, "List the authors.", "Keep the author list under 1,000 characters."),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("Enter the main author’s email address.").max(254)),
    institution: text(
      2,
      300,
      "Enter the main author’s institution.",
      "Keep this under 300 characters.",
    ),
    topic: z.string().trim().min(1, "Choose a topic.").max(300),
    topicOther: z.string().trim().max(200, "Keep the topic under 200 characters."),
    disciplineId: z.string().trim().min(1, "Choose the broad area of research."),
    disciplineOther: z.string().trim().max(200, "Keep this under 200 characters."),
    paperType: z.enum(PAPER_TYPES, "Choose the type of paper."),
    abstract: text(
      50,
      ABSTRACT_MAX,
      "Write an abstract of at least a few sentences.",
      `Keep the abstract under ${ABSTRACT_MAX.toLocaleString("en")} characters.`,
    ),
  })
  .superRefine((value, ctx) => {
    if (value.topic === OTHER && !value.topicOther) {
      ctx.addIssue({ code: "custom", path: ["topicOther"], message: "Type the topic." });
    }
    if (value.disciplineId === OTHER && !value.disciplineOther) {
      ctx.addIssue({
        code: "custom",
        path: ["disciplineOther"],
        message: "Type the area of research.",
      });
    }
  });

export type PaperDetailsInput = z.infer<typeof paperDetailsSchema>;

/** The stored form of a paper's details. */
export type PaperDetails = {
  title: string;
  authorNames: string;
  contactEmail: string;
  institution: string;
  topic: string;
  disciplineId: string | null;
  disciplineOther: string | null;
  paperType: (typeof PAPER_TYPES)[number];
  abstract: string;
};

export function resolvePaperDetails(input: PaperDetailsInput): PaperDetails {
  return {
    title: input.title,
    authorNames: input.authorNames,
    contactEmail: input.contactEmail,
    institution: input.institution,
    topic: input.topic === OTHER ? input.topicOther : input.topic,
    disciplineId: input.disciplineId === OTHER ? null : input.disciplineId,
    disciplineOther: input.disciplineId === OTHER ? input.disciplineOther : null,
    paperType: input.paperType,
    abstract: input.abstract,
  };
}

/** Word count, for the abstract field's hint. */
export function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}
