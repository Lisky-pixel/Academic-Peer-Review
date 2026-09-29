/**
 * Development seed.
 *
 * Idempotent — every write is an upsert, so `pnpm db:seed` can run repeatedly
 * without duplicating anything.
 *
 * Creates the reference data the application genuinely needs (document types
 * and their review templates) plus a set of known accounts for local testing.
 */

import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { type CriterionInputType, Role, UserStatus } from "@/lib/generated/prisma/client";

const DEV_PASSWORD = "Password123!";

type CriterionSeed = {
  label: string;
  helpText: string;
  inputType?: CriterionInputType;
};

/** Present on every template, always last, always free text. */
const OVERALL_FEEDBACK: CriterionSeed = {
  label: "Overall feedback",
  helpText: "Your summary for the author: what works, and the highest-impact things to change.",
  inputType: "TEXT",
};

const GRAMMAR: CriterionSeed = {
  label: "Grammar and mechanics",
  helpText: "Spelling, punctuation, agreement, and sentence-level correctness.",
};

const CLARITY: CriterionSeed = {
  label: "Clarity",
  helpText: "Is each sentence easy to follow on a first read?",
};

const STRUCTURE: CriterionSeed = {
  label: "Structure",
  helpText: "Does the piece flow in a logical order, with paragraphs that earn their place?",
};

/**
 * The 11 document types from the specification, each with the criteria a
 * reviewer of that document should actually be answering. A CV is not judged on
 * storytelling, and a personal statement is not judged on citations.
 */
const DOCUMENT_TYPES: Array<{
  name: string;
  slug: string;
  description: string;
  criteria: CriterionSeed[];
}> = [
  {
    name: "Personal Statement",
    slug: "personal-statement",
    description: "A narrative application essay about who you are and why you are applying.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Storytelling",
        helpText: "Does the narrative hold attention, with concrete detail rather than assertion?",
      },
      {
        label: "Personal voice",
        helpText: "Does this sound like a specific person, or like anyone's statement?",
      },
      {
        label: "Relevance",
        helpText: "Does every paragraph support the application being made?",
      },
      {
        label: "Opening",
        helpText: "Does the first paragraph earn the reader's attention?",
      },
      {
        label: "Conclusion",
        helpText: "Does the ending land, rather than simply stopping?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Statement of Purpose",
    slug: "statement-of-purpose",
    description: "An academic statement of research interests, goals, and programme fit.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Academic goals",
        helpText: "Are the stated goals specific and credible?",
      },
      {
        label: "Programme fit",
        helpText: "Is it clear why this programme, department, or supervisor in particular?",
      },
      {
        label: "Preparation and evidence",
        helpText: "Is prior work cited as evidence that the applicant can do what they propose?",
      },
      {
        label: "Conclusion",
        helpText: "Does the closing reinforce fit and direction?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Essay",
    slug: "essay",
    description: "An argumentative or analytical essay.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Thesis and argument",
        helpText: "Is there a clear central claim, sustained throughout?",
      },
      {
        label: "Evidence",
        helpText: "Are claims supported, and is the support relevant?",
      },
      {
        label: "Counterarguments",
        helpText: "Are obvious objections acknowledged and addressed?",
      },
      {
        label: "Conclusion",
        helpText: "Does the conclusion follow from the argument rather than restate the intro?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Journal",
    slug: "journal",
    description: "Reflective or personal journal writing.",
    criteria: [
      GRAMMAR,
      CLARITY,
      {
        label: "Depth of reflection",
        helpText: "Does the writing move past description into insight?",
      },
      {
        label: "Honesty and voice",
        helpText: "Does it read as genuine rather than performed?",
      },
      {
        label: "Organisation",
        helpText: "Can a reader follow the thread of thought?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Article",
    slug: "article",
    description: "A blog post, feature, or publication-bound article.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Headline and opening",
        helpText: "Would this earn a click, and then keep the reader past the first paragraph?",
      },
      {
        label: "Audience fit",
        helpText: "Is the level of assumed knowledge right for the intended reader?",
      },
      {
        label: "Accuracy and sourcing",
        helpText: "Are factual claims correct and attributed?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Academic Paper",
    slug: "academic-paper",
    description: "A scholarly paper intended for submission or publication.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Literature engagement",
        helpText: "Is relevant prior work engaged with, not merely listed?",
      },
      {
        label: "Methodology",
        helpText: "Are the methods appropriate and described reproducibly?",
      },
      {
        label: "Results and interpretation",
        helpText: "Do the conclusions follow from what was actually shown?",
      },
      {
        label: "Citations and formatting",
        helpText: "Is the citation style consistent and complete?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Cover Letter",
    slug: "cover-letter",
    description: "A letter accompanying a job application.",
    criteria: [
      GRAMMAR,
      CLARITY,
      {
        label: "Opening",
        helpText: "Does the first line give a reason to keep reading?",
      },
      {
        label: "Role fit",
        helpText: "Is it visibly written for this role, not a generic template?",
      },
      {
        label: "Evidence of impact",
        helpText: "Are achievements concrete and, where possible, quantified?",
      },
      {
        label: "Tone",
        helpText: "Confident without overclaiming; appropriate to the employer.",
      },
      {
        label: "Closing and call to action",
        helpText: "Does it end with a clear next step?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "CV/Resume",
    slug: "cv-resume",
    description: "A curriculum vitae or resume.",
    criteria: [
      {
        label: "Formatting and layout",
        helpText: "Is it scannable in the six seconds a recruiter actually gives it?",
      },
      {
        label: "Consistency",
        helpText: "Tense, punctuation, date formats, and heading styles applied uniformly.",
      },
      {
        label: "Impact statements",
        helpText: "Do bullets describe results achieved rather than duties held?",
      },
      {
        label: "Relevance and targeting",
        helpText: "Is the content aimed at the roles being applied for?",
      },
      {
        label: "Length",
        helpText: "Appropriate for the field and career stage.",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Scholarship Application",
    slug: "scholarship-application",
    description: "An essay or application for funding.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Fit with the award",
        helpText: "Does it address what this specific scholarship says it is looking for?",
      },
      {
        label: "Motivation and need",
        helpText: "Is the case compelling without being generic?",
      },
      {
        label: "Impact",
        helpText: "Is it clear what the funding would make possible?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "Research Proposal",
    slug: "research-proposal",
    description: "A proposal for a research project or thesis.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Problem statement",
        helpText: "Is the gap being addressed stated precisely?",
      },
      {
        label: "Objectives and questions",
        helpText: "Are the research questions answerable as written?",
      },
      {
        label: "Methodology",
        helpText: "Would these methods actually answer those questions?",
      },
      {
        label: "Feasibility",
        helpText: "Is the scope achievable with the stated time and resources?",
      },
      {
        label: "Significance",
        helpText: "Is it clear who would care about the result, and why?",
      },
      OVERALL_FEEDBACK,
    ],
  },
  {
    name: "General Writing",
    slug: "general-writing",
    description: "Anything that does not fit the other categories.",
    criteria: [
      GRAMMAR,
      CLARITY,
      STRUCTURE,
      {
        label: "Tone and register",
        helpText: "Is the voice appropriate to the purpose and audience?",
      },
      OVERALL_FEEDBACK,
    ],
  },
];

const ACCOUNTS: Array<{ email: string; name: string; role: Role }> = [
  { email: "admin@reviewflow.local", name: "Ada Admin", role: Role.ADMIN },
  { email: "reviewer1@reviewflow.local", name: "Rita Reviewer", role: Role.REVIEWER },
  { email: "reviewer2@reviewflow.local", name: "Raj Reviewer", role: Role.REVIEWER },
  { email: "user1@reviewflow.local", name: "Uma User", role: Role.USER },
  { email: "user2@reviewflow.local", name: "Ugo User", role: Role.USER },
  { email: "user3@reviewflow.local", name: "Ana Author", role: Role.USER },
];

async function seedSettings() {
  await db.appSetting.upsert({
    where: { key: "defaultAuthorVisibility" },
    update: {},
    create: { key: "defaultAuthorVisibility", value: true },
  });
  await db.appSetting.upsert({
    where: { key: "deadlineReminderLeadDays" },
    update: {},
    create: { key: "deadlineReminderLeadDays", value: 2 },
  });
  console.log("  settings           2");
}

async function seedDocumentTypes() {
  let templatesCreated = 0;

  for (const [index, type] of DOCUMENT_TYPES.entries()) {
    const documentType = await db.documentType.upsert({
      where: { slug: type.slug },
      update: { name: type.name, description: type.description, sortOrder: index },
      create: {
        name: type.name,
        slug: type.slug,
        description: type.description,
        sortOrder: index,
      },
    });

    // Templates are versioned: if version 1 already exists, leave it and its
    // criteria alone, because submitted reviews point at those exact criteria.
    const existing = await db.reviewTemplate.findUnique({
      where: { documentTypeId_version: { documentTypeId: documentType.id, version: 1 } },
    });
    if (existing) continue;

    await db.reviewTemplate.create({
      data: {
        documentTypeId: documentType.id,
        name: `${type.name} review`,
        version: 1,
        isActive: true,
        criteria: {
          create: type.criteria.map((criterion, order) => ({
            label: criterion.label,
            helpText: criterion.helpText,
            inputType: criterion.inputType ?? "BOTH",
            sortOrder: order,
          })),
        },
      },
    });
    templatesCreated += 1;
  }

  const criteria = await db.reviewCriterion.count();
  console.log(`  document types     ${DOCUMENT_TYPES.length}`);
  console.log(`  review templates   ${templatesCreated} created, ${criteria} criteria total`);
}

async function seedAccounts() {
  const passwordHash = await hashPassword(DEV_PASSWORD);

  for (const account of ACCOUNTS) {
    await db.user.upsert({
      where: { email: account.email },
      update: { name: account.name, role: account.role },
      create: {
        email: account.email.toLowerCase(),
        name: account.name,
        role: account.role,
        status: UserStatus.ACTIVE,
        passwordHash,
      },
    });
  }
  console.log(`  accounts           ${ACCOUNTS.length}`);
}

async function main() {
  console.log("Seeding ReviewFlow…\n");

  await seedSettings();
  await seedDocumentTypes();
  await seedAccounts();

  console.log(`\nAll accounts use the password: ${DEV_PASSWORD}`);
  for (const account of ACCOUNTS) {
    console.log(`  ${account.role.padEnd(9)} ${account.email}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error("\nSeed failed:", error);
    await db.$disconnect();
    process.exit(1);
  });
