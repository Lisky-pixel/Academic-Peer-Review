/**
 * Seed data.
 *
 *   pnpm db:seed:reference   the disciplines list; what a real deployment needs
 *   pnpm db:seed             disciplines, development accounts and two demo
 *                            conferences (development only)
 *   pnpm db:seed:demo        the demo conferences and accounts on a live site;
 *                            needs DEMO_PASSWORD, and uses .invalid addresses
 *                            so nothing is ever emailed to them
 *
 * The demo papers are driven through the real workflow — submitted, matched,
 * reviewed and decided by the same functions the pages call — so every row
 * is one the application could have produced itself.
 */

import { randomUUID } from "node:crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { hashPassword } from "@/lib/auth/password";
import { decide } from "@/lib/conferences";
import { db } from "@/lib/db";
import { dispatchQueuedEmails } from "@/lib/email/outbox";
import { runMatching } from "@/lib/matching";
import { acceptAssignment, declineAssignment, saveReview, submitReview } from "@/lib/reviews";
import { storage } from "@/lib/storage";
import { confirmUpload, createDraft, submitPaper } from "@/lib/submissions";
import { SYSTEM_ACTOR } from "@/lib/workflow/state-machine";

// Read when work is done, not at import: the queue is sent once at the end.
process.env.APR_DEFER_EMAIL = "1";

type Role = "USER" | "REVIEWER" | "ORGANISER" | "ADMIN";
type SessionUser = { id: string; email: string; name: string; role: Role; status: "ACTIVE" };

const DISCIPLINES = [
  "Agriculture and Food Science",
  "Architecture and Built Environment",
  "Arts and Humanities",
  "Biological Sciences",
  "Business and Management",
  "Computer Science and Information Technology",
  "Economics",
  "Education",
  "Engineering",
  "Environmental Science",
  "Health Sciences and Medicine",
  "Law",
  "Mathematics and Statistics",
  "Media and Communication",
  "Nursing and Midwifery",
  "Pharmacy and Pharmaceutical Sciences",
  "Physical Sciences",
  "Political Science and International Relations",
  "Psychology",
  "Public Health",
  "Sociology and Social Work",
  "Tourism, Hospitality and Events",
];

async function seedDisciplines() {
  for (const [index, name] of DISCIPLINES.entries()) {
    await db.discipline.upsert({
      where: { name },
      update: { sortOrder: index },
      create: { name, sortOrder: index },
    });
  }
  console.log(`  disciplines        ${DISCIPLINES.length}`);
}

// ── Accounts ───────────────────────────────────────────────────────────────

type AccountSeed = {
  key: string;
  name: string;
  role: Role;
  institution: string;
  reviewer?: { rank: string; years: number; expertise: string; disciplines: string[] };
};

const ACCOUNTS: AccountSeed[] = [
  { key: "admin", name: "Ada Admin", role: "ADMIN", institution: "Academic Peer Review" },
  {
    key: "organiser",
    name: "Olu Organiser",
    role: "ORGANISER",
    institution: "African Research Network",
  },
  {
    key: "reviewer1",
    name: "Dr Rita Mensah",
    role: "REVIEWER",
    institution: "University of Ghana",
    reviewer: {
      rank: "Senior Lecturer",
      years: 12,
      expertise: "Maternal and child health, health systems",
      disciplines: ["Public Health", "Health Sciences and Medicine"],
    },
  },
  {
    key: "reviewer2",
    name: "Prof. Raj Okonkwo",
    role: "REVIEWER",
    institution: "University of Nigeria, Nsukka",
    reviewer: {
      rank: "Professor",
      years: 25,
      expertise: "Epidemiology, infectious disease modelling",
      disciplines: ["Public Health", "Mathematics and Statistics"],
    },
  },
  {
    key: "reviewer3",
    name: "Dr Wanjiru Kamau",
    role: "REVIEWER",
    institution: "University of Nairobi",
    reviewer: {
      rank: "Associate Professor",
      years: 15,
      expertise: "Health economics, financing of primary care",
      disciplines: ["Public Health", "Economics"],
    },
  },
  {
    key: "reviewer4",
    name: "Dr Thabo Nkosi",
    role: "REVIEWER",
    institution: "University of Cape Town",
    reviewer: {
      rank: "Senior Lecturer",
      years: 9,
      expertise: "Nursing workforce, midwifery education",
      disciplines: ["Nursing and Midwifery", "Health Sciences and Medicine", "Public Health"],
    },
  },
  {
    key: "reviewer5",
    name: "Dr Amina Bello",
    role: "REVIEWER",
    institution: "Ahmadu Bello University",
    reviewer: {
      rank: "Lecturer",
      years: 6,
      expertise: "Climate adaptation, smallholder agriculture",
      disciplines: ["Environmental Science", "Agriculture and Food Science", "Public Health"],
    },
  },
  {
    key: "reviewer6",
    name: "Dr Kofi Asante",
    role: "REVIEWER",
    institution: "Kwame Nkrumah University of Science and Technology",
    reviewer: {
      rank: "Senior Lecturer",
      years: 11,
      expertise: "Development economics, mobile money, fintech",
      disciplines: ["Economics", "Business and Management", "Agriculture and Food Science"],
    },
  },
  {
    key: "reviewer7",
    name: "Dr Fatou Diop",
    role: "REVIEWER",
    institution: "Université Cheikh Anta Diop",
    reviewer: {
      rank: "Associate Professor",
      years: 14,
      expertise: "Event tourism, destination management",
      disciplines: ["Tourism, Hospitality and Events", "Business and Management", "Economics"],
    },
  },
  {
    key: "reviewer8",
    name: "Dr Samuel Tadesse",
    role: "REVIEWER",
    institution: "Addis Ababa University",
    reviewer: {
      rank: "Assistant Lecturer",
      years: 4,
      expertise: "Renewable energy systems, rural electrification",
      disciplines: ["Engineering", "Environmental Science", "Public Health"],
    },
  },
  { key: "user1", name: "Uche Eze", role: "USER", institution: "University of Lagos" },
  { key: "user2", name: "Grace Atieno", role: "USER", institution: "Makerere University" },
  { key: "user3", name: "Yaw Boateng", role: "USER", institution: "University of Cape Coast" },
];

async function seedAccounts(domain: string, password: string): Promise<Map<string, SessionUser>> {
  const passwordHash = await hashPassword(password);
  const disciplines = new Map(
    (await db.discipline.findMany({ select: { id: true, name: true } })).map((d) => [d.name, d.id]),
  );
  const users = new Map<string, SessionUser>();

  for (const account of ACCOUNTS) {
    const email = `${account.key}@${domain}`;
    const user = await db.user.upsert({
      where: { email },
      update: { name: account.name, role: account.role, institution: account.institution },
      create: {
        email,
        name: account.name,
        role: account.role,
        institution: account.institution,
        status: "ACTIVE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    if (account.reviewer) {
      const connect = account.reviewer.disciplines.map((name) => ({ id: disciplines.get(name)! }));
      const profile = {
        academicRank: account.reviewer.rank,
        yearsExperience: account.reviewer.years,
        expertise: account.reviewer.expertise,
      };
      await db.reviewerProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...profile, disciplines: { connect } },
        update: { ...profile, disciplines: { set: connect } },
      });
    }
    users.set(account.key, { ...user, role: user.role as Role, status: "ACTIVE" });
  }
  console.log(`  accounts           ${ACCOUNTS.length}`);
  return users;
}

// ── Demo papers ────────────────────────────────────────────────────────────

/** A plain one-page PDF with the paper's title and abstract and no author names. */
async function paperPdf(title: string, abstract: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const bold = await document.embedFont(StandardFonts.TimesRomanBold);

  const wrap = (text: string, size: number, width: number, using = font) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (using.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  let y = 770;
  for (const line of wrap(title, 18, 480, bold)) {
    page.drawText(line, { x: 58, y, size: 18, font: bold, color: rgb(0.08, 0.1, 0.16) });
    y -= 24;
  }
  y -= 14;
  page.drawText("Abstract", { x: 58, y, size: 12, font: bold });
  y -= 20;
  for (const line of wrap(abstract, 11.5, 480)) {
    page.drawText(line, { x: 58, y, size: 11.5, font });
    y -= 16;
  }
  y -= 18;
  page.drawText("1. Introduction", { x: 58, y, size: 12, font: bold });
  y -= 20;
  const body =
    "This document is a demonstration paper created for Academic Peer Review. The full text of a real submission would appear here, with its methods, results and discussion. Author names have been removed for blind review.";
  for (const line of wrap(body, 11.5, 480)) {
    page.drawText(line, { x: 58, y, size: 11.5, font });
    y -= 16;
  }
  return document.save();
}

type PaperSeed = {
  submitter: string;
  title: string;
  authors: string;
  topic: string;
  discipline: string;
  type: "QUANTITATIVE" | "QUALITATIVE" | "CONCEPTUAL" | "REVIEW";
  abstract: string;
};

async function submitDemoPaper(
  users: Map<string, SessionUser>,
  conferenceId: string,
  paper: PaperSeed,
): Promise<string> {
  const author = users.get(paper.submitter)!;
  const discipline = await db.discipline.findUniqueOrThrow({ where: { name: paper.discipline } });
  const institution = ACCOUNTS.find((account) => account.key === paper.submitter)!.institution;

  const draft = await createDraft(
    author,
    conferenceId,
    {
      title: paper.title,
      authorNames: paper.authors,
      contactEmail: author.email,
      institution,
      topic: paper.topic,
      disciplineId: discipline.id,
      disciplineOther: null,
      paperType: paper.type,
      abstract: paper.abstract,
    },
    false,
  );
  if (!draft.ok) throw new Error(`Could not draft "${paper.title}": ${draft.reason}`);

  const rawKey = `submissions/${draft.id}/raw/${randomUUID()}.pdf`;
  await storage().write(rawKey, await paperPdf(paper.title, paper.abstract), "application/pdf");
  const uploaded = await confirmUpload(author, draft.id, rawKey, `${paper.title.slice(0, 60)}.pdf`);
  if (!uploaded.ok) throw new Error(`Could not attach the paper: ${uploaded.reason}`);

  const submitted = await submitPaper(author, draft.id, true);
  if (!submitted.ok) throw new Error(`Could not submit "${paper.title}": ${submitted.reason}`);
  return draft.id;
}

/** The reviewers a paper was matched to, as signed-in users. */
async function reviewersOf(users: Map<string, SessionUser>, paperId: string) {
  const assignments = await db.assignment.findMany({
    where: { submissionId: paperId, status: { in: ["PENDING", "ACCEPTED"] } },
    orderBy: { assignedAt: "asc" },
    select: { reviewerId: true },
  });
  const byId = new Map([...users.values()].map((user) => [user.id, user]));
  return assignments.map((assignment) => byId.get(assignment.reviewerId)!);
}

async function review(
  reviewer: SessionUser,
  paperId: string,
  score: number,
  recommend: boolean,
  comments: string,
) {
  await acceptAssignment(reviewer, paperId);
  const saved = await saveReview(reviewer, paperId, { score, recommend, comments });
  if (!saved.ok) throw new Error(`Could not save a review: ${saved.reason}`);
  const sent = await submitReview(reviewer, paperId);
  if (!sent.ok) throw new Error(`Could not submit a review: ${sent.reason}`);
}

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

const HEALTH_TOPICS = [
  "Maternal and child health",
  "Infectious diseases",
  "Health financing",
  "Health workforce",
  "Digital health",
  "Climate and health",
];

const HEALTH_PAPERS: PaperSeed[] = [
  {
    submitter: "user1",
    title: "Antenatal care attendance and birth outcomes in peri-urban Lagos: a cohort study",
    authors: "U. Eze, B. Adeyemi, C. Okafor",
    topic: "Maternal and child health",
    discipline: "Public Health",
    type: "QUANTITATIVE",
    abstract:
      "We followed 1,240 pregnant women attending primary health centres in peri-urban Lagos to examine how the number and timing of antenatal visits relate to birth outcomes. Women who attended four or more visits had lower odds of low birth weight and preterm delivery after adjusting for age, parity and household income. Late first attendance, after twenty weeks, remained common and was associated with distance to the facility. We discuss practical steps for community outreach that could move first visits earlier.",
  },
  {
    submitter: "user2",
    title: "Community health workers and malaria case management in rural Uganda",
    authors: "G. Atieno, P. Ssemanda",
    topic: "Infectious diseases",
    discipline: "Public Health",
    type: "QUALITATIVE",
    abstract:
      "Through forty in-depth interviews with community health workers and district supervisors in two rural districts of Uganda, this study explores how malaria case management works in practice. Workers described stock-outs of rapid tests, long walking distances and irregular supervision as the main barriers, and peer support groups as an unexpected strength. We propose a supervision model that builds on these groups and reduces the burden of monthly reporting.",
  },
  {
    submitter: "user3",
    title: "Out-of-pocket spending under Ghana's National Health Insurance Scheme",
    authors: "Y. Boateng, A. Owusu, E. Darko",
    topic: "Health financing",
    discipline: "Economics",
    type: "QUANTITATIVE",
    abstract:
      "Using three rounds of the Ghana Living Standards Survey, we estimate how much insured households still pay out of pocket for outpatient care. Despite enrolment, medicines and diagnostics outside the benefits package account for most spending, and the poorest quintile faces catastrophic expenditure at twice the rate of the richest. We model the cost of extending coverage to the most frequently purchased medicines.",
  },
  {
    submitter: "user1",
    title: "Retaining midwives in northern Nigeria: what makes them stay?",
    authors: "U. Eze, H. Musa",
    topic: "Health workforce",
    discipline: "Nursing and Midwifery",
    type: "QUALITATIVE",
    abstract:
      "Northern Nigeria loses a large share of newly qualified midwives within three years of posting. Drawing on focus groups with 62 midwives in Kano and Kaduna states, we identify housing, safety on night shifts and opportunities for further training as the strongest reasons to stay. Financial incentives mattered less than expected. The findings suggest low-cost changes that state health boards could make within existing budgets.",
  },
  {
    submitter: "user2",
    title: "Mobile phone reminders and immunisation completion: a systematic review",
    authors: "G. Atieno, J. Mwangi, L. Achieng",
    topic: "Digital health",
    discipline: "Public Health",
    type: "REVIEW",
    abstract:
      "We systematically reviewed randomised and quasi-experimental studies from sub-Saharan Africa that used SMS or voice reminders to improve childhood immunisation completion. Eighteen studies met the inclusion criteria. Reminders increased completion of the full schedule by between four and nineteen percentage points, with larger effects where messages were in local languages and sent to more than one caregiver. Evidence on cost-effectiveness remains thin.",
  },
  {
    submitter: "user3",
    title: "Heat waves and hospital admissions in Accra, 2010–2024",
    authors: "Y. Boateng, K. Agyeman",
    topic: "Climate and health",
    discipline: "Environmental Science",
    type: "QUANTITATIVE",
    abstract:
      "Linking daily temperature records with admissions to two teaching hospitals in Accra, we estimate the effect of heat waves on admissions for cardiovascular, respiratory and renal conditions. Admissions rose by 11 per cent on days above the 95th percentile of temperature, with effects lasting three days and strongest among adults over 65. We argue for a heat-health early warning system linked to the national meteorological service.",
  },
];

const TOURISM_PAPERS: PaperSeed[] = [
  {
    submitter: "user2",
    title: "Business events and the night-time economy of Kigali",
    authors: "G. Atieno",
    topic: "Business events and MICE",
    discipline: "Tourism, Hospitality and Events",
    type: "QUALITATIVE",
    abstract:
      "Kigali has positioned itself as a leading destination for international conferences. Through interviews with hoteliers, restaurant owners and event organisers, this paper examines how conference delegates contribute to the city's night-time economy and who benefits. Spending is concentrated in a small number of venues near the convention centre, and we suggest ways to spread it further.",
  },
  {
    submitter: "user3",
    title: "Mobile money adoption among smallholder farmers in Northern Ghana",
    authors: "Y. Boateng, S. Alhassan",
    topic: "Digital finance",
    discipline: "Economics",
    type: "QUANTITATIVE",
    abstract:
      "Using a survey of 860 smallholder households in the Northern Region of Ghana, we estimate the factors associated with mobile money adoption and its link to input purchases. Distance to an agent, literacy and network coverage predict adoption. Adopting households bought more fertiliser and improved seed in the following season, consistent with easier access to remittances.",
  },
];

async function seedDemo(domain: string, password: string) {
  const exists = await db.conference.findUnique({
    where: { slug: "west-african-health-research-summit-2026" },
  });
  if (exists) {
    console.log("  demo conferences   already there, left alone");
    return seedAccounts(domain, password);
  }

  const users = await seedAccounts(domain, password);
  const admin = users.get("admin")!;
  const organiser = users.get("organiser")!;

  // A conference whose call has closed and whose reviews are under way. It is
  // created open, so the papers can be submitted through the real rules, then
  // its dates are moved into the past.
  const health = await db.conference.create({
    data: {
      name: "West African Health Research Summit 2026",
      slug: "west-african-health-research-summit-2026",
      description:
        "Research on health systems, disease and wellbeing in West Africa and beyond. Papers are reviewed double-blind by two reviewers.",
      venue: "Accra International Conference Centre, Ghana",
      startsOn: at(40),
      endsOn: at(42),
      submissionsOpenAt: at(-30),
      submissionsCloseAt: at(5),
      reviewDeadline: at(12),
      reviewersPerPaper: 2,
      maxPapersPerReviewer: 4,
      doubleBlind: true,
      submissionFormat: "FULL_PAPER",
      topics: HEALTH_TOPICS,
      packageName: "Standard",
      submissionLimit: 200,
      organisers: { create: { userId: organiser.id } },
    },
  });
  const healthIds: string[] = [];
  for (const paper of HEALTH_PAPERS) healthIds.push(await submitDemoPaper(users, health.id, paper));

  await db.conference.update({
    where: { id: health.id },
    data: { submissionsCloseAt: at(-2) },
  });
  await runMatching(health.id, SYSTEM_ACTOR);

  // Paper 1: both reviews in and in agreement; accepted.
  const [a1, a2] = await reviewersOf(users, healthIds[0]!);
  await review(
    a1!,
    healthIds[0]!,
    5,
    true,
    "A clear and well-designed cohort study. The adjustment for income is convincing, and the discussion of distance to facilities is especially useful for policy. Consider adding a sensitivity analysis excluding women who moved during pregnancy.",
  );
  await review(
    a2!,
    healthIds[0]!,
    4,
    true,
    "Strong data and an important question. The methods section should state how gestational age was measured. The conclusions follow from the results.",
  );
  await decide(
    organiser,
    health.id,
    healthIds[0]!,
    true,
    "Congratulations. Please prepare a 15-minute oral presentation.",
  );

  // Paper 2: both reviews in and in agreement; ready for a decision.
  const [b1, b2] = await reviewersOf(users, healthIds[1]!);
  await review(
    b1!,
    healthIds[1]!,
    4,
    true,
    "Rich qualitative material and a thoughtful proposal. The sampling of supervisors could be described in more detail, and quotations would benefit from indicating the district.",
  );
  await review(
    b2!,
    healthIds[1]!,
    4,
    true,
    "Well written and relevant. The discussion of peer support groups is the most original part and deserves more space.",
  );

  // Paper 3: the reviews disagree, so a tie-breaker has been added.
  const [c1, c2] = await reviewersOf(users, healthIds[2]!);
  await review(
    c1!,
    healthIds[2]!,
    5,
    true,
    "An excellent use of survey data with clear policy implications. The modelling of coverage extension is a real contribution.",
  );
  await review(
    c2!,
    healthIds[2]!,
    2,
    false,
    "The question is important, but the analysis does not account for changes in the benefits package between survey rounds, which could explain much of the trend. I would want to see this addressed before acceptance.",
  );

  // Paper 4: only one reviewer works in its discipline, so it is one short.
  const [d1, d2] = await reviewersOf(users, healthIds[3]!);
  await review(
    d1!,
    healthIds[3]!,
    3,
    true,
    "Useful findings for state health boards. The paper would be stronger with a short comparison to retention studies from other regions.",
  );
  if (d2) await acceptAssignment(d2, healthIds[3]!);

  // Paper 5: both reviews in, both against; rejected.
  const [e1, e2] = await reviewersOf(users, healthIds[4]!);
  await review(
    e1!,
    healthIds[4]!,
    2,
    false,
    "The review follows a recognised method, but several eligible studies from West Africa appear to be missing and the risk-of-bias assessment is not reported. Please broaden the search.",
  );
  await review(
    e2!,
    healthIds[4]!,
    2,
    false,
    "The conclusions go further than the pooled evidence allows. I encourage the authors to resubmit once the search is updated.",
  );
  await decide(
    organiser,
    health.id,
    healthIds[4]!,
    false,
    "Thank you for your submission. We hope the reviewers' comments help with a future version.",
  );

  // Paper 6: one reviewer declined with a conflict of interest. Nobody else in
  // that discipline is free, so the organisers are told it needs a reviewer.
  const [f1] = await reviewersOf(users, healthIds[5]!);
  if (f1) {
    await declineAssignment(f1, healthIds[5]!, {
      reason: "I supervised one of the authors.",
      conflict: true,
    });
  }

  // A second conference with its call still open, for submitting live.
  const tourism = await db.conference.create({
    data: {
      name: "African Conference on Tourism, Events and Development 2026",
      slug: "african-conference-on-tourism-events-and-development-2026",
      description:
        "The economics and management of tourism, hospitality and business events across the continent.",
      venue: "Kigali Convention Centre, Rwanda",
      startsOn: at(75),
      endsOn: at(77),
      submissionsOpenAt: at(-10),
      submissionsCloseAt: at(21),
      reviewDeadline: at(45),
      reviewersPerPaper: 2,
      maxPapersPerReviewer: 5,
      doubleBlind: true,
      submissionFormat: "FULL_PAPER",
      topics: [
        "Business events and MICE",
        "Destination management",
        "Hospitality operations",
        "Digital finance",
        "Sustainable tourism",
      ],
      packageName: "Starter",
      submissionLimit: 80,
      organisers: { create: { userId: organiser.id } },
    },
  });
  for (const paper of TOURISM_PAPERS) await submitDemoPaper(users, tourism.id, paper);

  await db.payment.create({
    data: {
      conferenceId: health.id,
      amountMinor: 25_000_000,
      currency: "NGN",
      description: "Standard package, 2026 edition",
      reference: "TRF-88412",
      paidAt: at(-35),
      recordedById: admin.id,
      receiptNumber: `APR-R-${new Date().getUTCFullYear()}-DEMO`,
      receiptSentAt: at(-35),
    },
  });

  console.log("  demo conferences   2, with 8 papers at every stage");
  return users;
}

async function main() {
  const referenceOnly = process.argv.includes("--reference-only");
  const demo = process.argv.includes("--demo");
  const production = process.env.NODE_ENV === "production";

  if (!referenceOnly && !demo && production) {
    throw new Error(
      "Refusing to create development accounts in production. " +
        "Run `pnpm db:seed:reference`, then `pnpm admin:create` (and `pnpm db:seed:demo` for demo data).",
    );
  }

  console.log("Seeding Academic Peer Review…\n");
  await seedDisciplines();
  if (referenceOnly) return;

  let domain = "apr.local";
  let password = "Password123!";
  if (demo) {
    const chosen = process.env.DEMO_PASSWORD ?? "";
    if (chosen.length < 10) {
      throw new Error("Set DEMO_PASSWORD (at least 10 characters) for the demo accounts.");
    }
    // Reserved: these addresses can never receive mail, so nothing is sent.
    domain = "demo.invalid";
    password = chosen;
  }

  await seedDemo(domain, password);

  const result = await dispatchQueuedEmails(500);
  console.log(
    `  emails sent        ${result.sent}${result.failed ? `, ${result.failed} failed` : ""}`,
  );

  console.log(`\nAccounts (password: ${demo ? "the DEMO_PASSWORD you set" : password}):`);
  for (const account of ACCOUNTS) {
    console.log(`  ${account.role.padEnd(10)} ${account.key}@${domain}`);
  }
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
