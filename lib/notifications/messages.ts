import type { EmailContent } from "@/lib/email/template";
import type { NotificationType } from "@/lib/generated/prisma/client";

/**
 * Every notification the system sends, as words.
 *
 * Each builder returns the in-app notification (title, body, link) and the
 * email that goes with it. They are pure functions of a few plain values, so
 * what a person is told is decided here and nowhere else.
 *
 * ANONYMITY IS STRUCTURAL HERE. The builders for submitters take a
 * `SubmissionRef` — a reference, a title and ids. There is no parameter
 * through which a reviewer's name could arrive, so no submitter-facing
 * message can contain one. The builders for a reviewer likewise take no
 * author. If a message ever needs a person's name, that is a decision to make
 * in review, not a field to add in passing.
 */

/** All a message may know about a paper. */
export type SubmissionRef = { id: string; reference: string; title: string; conferenceId: string };

export type Message = {
  type: NotificationType;
  title: string;
  body: string;
  /** Where the notification leads, relative to the site. */
  linkPath: string;
  email: { subject: string; content: EmailContent };
};

function message(
  type: NotificationType,
  input: {
    title: string;
    body: string;
    linkPath: string;
    subject: string;
    paragraphs: string[];
    cta: string;
  },
): Message {
  return {
    type,
    title: input.title,
    body: input.body,
    linkPath: input.linkPath,
    email: {
      subject: input.subject,
      content: {
        heading: input.title,
        paragraphs: input.paragraphs,
        cta: { label: input.cta, path: input.linkPath },
      },
    },
  };
}

export const submitterPath = (s: { id: string }) => `/dashboard/papers/${s.id}`;
export const reviewerPath = (s: { id: string }) => `/reviewer/reviews/${s.id}`;
export const organiserPath = (s: { id: string; conferenceId: string }) =>
  `/organiser/conferences/${s.conferenceId}/papers/${s.id}`;

// ── To the submitter ───────────────────────────────────────────────────────

export const toSubmitter = {
  submissionReceived: (s: SubmissionRef, conferenceName: string) =>
    message("SUBMISSION_RECEIVED", {
      title: "We have your paper",
      body: `${s.reference} has been submitted to ${conferenceName}.`,
      linkPath: submitterPath(s),
      subject: `Paper received: ${s.reference}`,
      paragraphs: [
        `Thank you for submitting “${s.title}” to ${conferenceName}. Its reference is ${s.reference}.`,
        "You can still edit it until it is sent to reviewers. We will email you when a decision has been made.",
      ],
      cta: "View your paper",
    }),

  decisionMade: (s: SubmissionRef, accepted: boolean, conferenceName: string) =>
    message("DECISION_MADE", {
      title: accepted ? "Your paper has been accepted" : "A decision on your paper",
      body: accepted
        ? `${s.reference} has been accepted for ${conferenceName}.`
        : `${s.reference} has not been accepted for ${conferenceName}.`,
      linkPath: submitterPath(s),
      subject: accepted
        ? `Accepted: ${s.reference} at ${conferenceName}`
        : `Decision on ${s.reference} for ${conferenceName}`,
      paragraphs: accepted
        ? [
            `Congratulations: “${s.title}” (${s.reference}) has been accepted for ${conferenceName}.`,
            "The reviewers’ scores and comments are ready for you to read.",
          ]
        : [
            `Thank you for submitting “${s.title}” (${s.reference}) to ${conferenceName}. After review, it has not been accepted this time.`,
            "The reviewers’ scores and comments are ready for you to read, and we hope they help with your next submission.",
          ],
      cta: "Read the reviews",
    }),
};

// ── To the reviewer ────────────────────────────────────────────────────────

export const toReviewer = {
  assignmentReceived: (s: SubmissionRef, dueAt: string) =>
    message("ASSIGNMENT_RECEIVED", {
      title: "A paper to review",
      body: `${s.reference} has been assigned to you.`,
      linkPath: reviewerPath(s),
      subject: `New paper to review: ${s.reference}`,
      paragraphs: [
        `You have been matched with “${s.title}” (${s.reference}).`,
        `The review is due by ${dueAt}. Please accept or decline soon, so the paper can go to someone else if you cannot take it.`,
      ],
      cta: "Open the paper",
    }),

  assignmentCancelled: (s: SubmissionRef) =>
    message("ASSIGNMENT_CANCELLED", {
      title: "Review no longer needed",
      body: `You no longer need to review ${s.reference}.`,
      linkPath: "/reviewer",
      subject: `Review no longer needed: ${s.reference}`,
      paragraphs: [
        `You no longer need to review “${s.title}” (${s.reference}). Thank you for your time.`,
      ],
      cta: "Open your queue",
    }),

  deadlineApproaching: (s: SubmissionRef, dueAt: string, daysLeft: number) =>
    message("DEADLINE_APPROACHING", {
      title: daysLeft <= 1 ? "A review is due tomorrow" : `A review is due in ${daysLeft} days`,
      body: `Your review of ${s.reference} is due by ${dueAt}.`,
      linkPath: reviewerPath(s),
      subject: `Reminder: review of ${s.reference} due ${dueAt}`,
      paragraphs: [
        `Your review of “${s.title}” (${s.reference}) is due by ${dueAt}.`,
        "If you cannot finish it, please decline so the paper can be given to another reviewer.",
      ],
      cta: "Continue the review",
    }),
};

// ── To organisers ──────────────────────────────────────────────────────────

export const toOrganiser = {
  needsReviewers: (s: SubmissionRef, missing: number) =>
    message("NEEDS_REVIEWERS", {
      title: "A paper needs reviewers",
      body: `No suitable reviewer was free for ${missing === 1 ? "one place" : `${missing} places`} on ${s.reference}.`,
      linkPath: organiserPath(s),
      subject: `Needs reviewers: ${s.reference}`,
      paragraphs: [
        `“${s.title}” (${s.reference}) still needs ${missing === 1 ? "one reviewer" : `${missing} reviewers`}. Nobody available matched its discipline without a conflict or a full workload.`,
        "You can assign someone yourself from the paper’s page.",
      ],
      cta: "Assign a reviewer",
    }),

  reviewsComplete: (s: SubmissionRef) =>
    message("REVIEWS_COMPLETE", {
      title: "Reviews complete",
      body: `Every review of ${s.reference} is in. It is ready for your decision.`,
      linkPath: organiserPath(s),
      subject: `Ready for a decision: ${s.reference}`,
      paragraphs: [
        `Every review of “${s.title}” (${s.reference}) has been submitted.`,
        "It is ready for you to accept or reject.",
      ],
      cta: "Make a decision",
    }),

  reviewOverdue: (s: SubmissionRef, dueAt: string) =>
    message("REVIEW_OVERDUE", {
      title: "A review is overdue",
      body: `A review of ${s.reference} was due by ${dueAt}.`,
      linkPath: organiserPath(s),
      subject: `Overdue review: ${s.reference}`,
      paragraphs: [
        `A review of “${s.title}” (${s.reference}) was due by ${dueAt} and has not been submitted.`,
        "You can wait, or remove that reviewer and assign another from the paper’s page.",
      ],
      cta: "View the paper",
    }),

  paymentReceipt: (input: {
    conferenceId: string;
    conferenceName: string;
    receiptNumber: string;
    amount: string;
    description: string;
    paidOn: string;
    reference: string | null;
  }) =>
    message("PAYMENT_RECEIPT", {
      title: `Receipt ${input.receiptNumber}`,
      body: `Payment of ${input.amount} received for ${input.conferenceName}.`,
      linkPath: `/organiser/conferences/${input.conferenceId}`,
      subject: `Receipt ${input.receiptNumber}: ${input.amount} for ${input.conferenceName}`,
      paragraphs: [
        `Thank you. We have received your payment for ${input.conferenceName}.`,
        `Receipt number: ${input.receiptNumber}`,
        `Amount: ${input.amount}`,
        `For: ${input.description}`,
        `Paid on: ${input.paidOn}`,
        ...(input.reference ? [`Your reference: ${input.reference}`] : []),
        "Please keep this email for your records.",
      ],
      cta: "Open the conference",
    }),
};

// ── Conference requests ────────────────────────────────────────────────────

export type InvoiceFacts = {
  invoiceId: string;
  number: string;
  conferenceId: string;
  conferenceName: string;
  packageName: string;
  amount: string;
  dueOn: string;
  /** What the administrator has written about how to pay; may be several paragraphs. */
  paymentInstructions: string;
};

export const toRequester = {
  invoiceIssued: (invoice: InvoiceFacts) =>
    message("CONFERENCE_REQUESTED", {
      title: `Invoice ${invoice.number}`,
      body: `${invoice.amount} for ${invoice.conferenceName}, due by ${invoice.dueOn}.`,
      linkPath: `/organiser/invoices/${invoice.invoiceId}`,
      subject: `Invoice ${invoice.number} for ${invoice.conferenceName}`,
      paragraphs: [
        `Thank you for requesting ${invoice.conferenceName}. Here is your invoice.`,
        `Invoice number: ${invoice.number}`,
        `Package: ${invoice.packageName}`,
        `Amount due: ${invoice.amount}`,
        `Due by: ${invoice.dueOn}`,
        "How to pay:",
        ...invoice.paymentInstructions
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean),
        `Please quote ${invoice.number} as your payment reference. Once your payment is confirmed we will approve the conference, email you a receipt, and your call for papers will open.`,
      ],
      cta: "View the invoice",
    }),

  approved: (input: { conferenceId: string; conferenceName: string; opensOn: string }) =>
    message("CONFERENCE_DECIDED", {
      title: "Your conference is approved",
      body: `${input.conferenceName} is approved. The call for papers opens on ${input.opensOn}.`,
      linkPath: `/organiser/conferences/${input.conferenceId}`,
      subject: `Approved: ${input.conferenceName}`,
      paragraphs: [
        `Good news: ${input.conferenceName} has been approved.`,
        `Its call for papers opens on ${input.opensOn}. From then, authors can submit, and you can follow every paper from your conference page.`,
      ],
      cta: "Open your conference",
    }),

  declined: (input: { conferenceId: string; conferenceName: string; reason: string }) =>
    message("CONFERENCE_DECIDED", {
      title: "Your conference request was not approved",
      body: `${input.conferenceName} was not approved.`,
      linkPath: "/organiser",
      subject: `Not approved: ${input.conferenceName}`,
      paragraphs: [
        `We are sorry: ${input.conferenceName} has not been approved.`,
        `The reason given: ${input.reason}`,
        "If you have questions, reply through the help page and we will get back to you.",
      ],
      cta: "Open your conferences",
    }),
};

export const toAdministrators = {
  conferenceRequested: (input: {
    conferenceId: string;
    conferenceName: string;
    organiserName: string;
    amount: string;
    invoiceNumber: string;
  }) =>
    message("CONFERENCE_REQUESTED", {
      title: "New conference request",
      body: `${input.organiserName} requested ${input.conferenceName}.`,
      linkPath: `/admin/conferences/${input.conferenceId}`,
      subject: `New conference request: ${input.conferenceName}`,
      paragraphs: [
        `${input.organiserName} has requested ${input.conferenceName}.`,
        `Invoice ${input.invoiceNumber} for ${input.amount} has been sent to them. When they have paid, mark the invoice paid and approve the conference.`,
      ],
      cta: "Review the request",
    }),
};
