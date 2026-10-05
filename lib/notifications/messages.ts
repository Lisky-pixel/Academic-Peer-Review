import type { EmailContent } from "@/lib/email/template";
import type { NotificationType } from "@/lib/generated/prisma/client";

/**
 * Every notification the system sends, as words.
 *
 * Each builder returns the in-app notification (title, body, link) and the
 * email that goes with it. They are pure functions of a few plain values, so
 * what a person is told is decided here and nowhere else.
 *
 * ANONYMITY IS STRUCTURAL HERE. The builders for the author take a
 * `SubmissionRef` — a reference, a title and an id. There is no parameter
 * through which a reviewer's name could arrive, so no author-facing message
 * can contain one. The builders for a reviewer likewise take no author. If a
 * message ever needs a person's name, that is a decision to make in review,
 * not a field to add in passing.
 */

/** All a message may know about a submission. */
export type SubmissionRef = { id: string; reference: string; title: string };

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

const authorPath = (s: SubmissionRef) => `/dashboard/submissions/${s.id}`;
const reviewerPath = (s: SubmissionRef) => `/reviewer/reviews/${s.id}`;
const adminPath = (s: SubmissionRef) => `/admin/submissions/${s.id}`;

// ── To the author ──────────────────────────────────────────────────────────

export const toAuthor = {
  submissionReceived: (s: SubmissionRef) =>
    message("SUBMISSION_RECEIVED", {
      title: "We have your submission",
      body: `${s.reference} is waiting to be matched with a reviewer.`,
      linkPath: authorPath(s),
      subject: `We have your submission (${s.reference})`,
      paragraphs: [
        `Thank you for submitting “${s.title}”. Its reference is ${s.reference}.`,
        "It is now waiting to be matched with a reviewer. We will email you when a reviewer has been assigned and again when your review is ready.",
      ],
      cta: "View your submission",
    }),

  reviewerAssigned: (s: SubmissionRef) =>
    message("SUBMISSION_STATUS_CHANGED", {
      title: "A reviewer has been assigned",
      body: `${s.reference} has been matched with a reviewer.`,
      linkPath: authorPath(s),
      subject: `A reviewer has been assigned (${s.reference})`,
      paragraphs: [
        `“${s.title}” has been matched with a reviewer, who will now read it and write their feedback.`,
        "Your reviewer stays anonymous throughout. We will email you when the review is ready.",
      ],
      cta: "View your submission",
    }),

  reviewReady: (s: SubmissionRef) =>
    message("REVIEW_READY", {
      title: "Your review is ready",
      body: `The review of ${s.reference} is ready to read.`,
      linkPath: authorPath(s),
      subject: `Your review is ready (${s.reference})`,
      paragraphs: [
        `The review of “${s.title}” is ready.`,
        "You can read the feedback on each criterion and download your document with the reviewer’s changes and comments.",
      ],
      cta: "Read your review",
    }),

  cancelled: (s: SubmissionRef) =>
    message("SUBMISSION_STATUS_CHANGED", {
      title: "Submission cancelled",
      body: `${s.reference} has been cancelled.`,
      linkPath: authorPath(s),
      subject: `Your submission was cancelled (${s.reference})`,
      paragraphs: [
        `“${s.title}” (${s.reference}) has been cancelled and will not be reviewed.`,
        "If you did not expect this, please contact the administrator.",
      ],
      cta: "View your submission",
    }),
};

// ── To the reviewer ────────────────────────────────────────────────────────

export const toReviewer = {
  assignmentReceived: (s: SubmissionRef, dueAt: string | null) =>
    message("ASSIGNMENT_RECEIVED", {
      title: "New document to review",
      body: `${s.reference} has been assigned to you.`,
      linkPath: reviewerPath(s),
      subject: `New document to review (${s.reference})`,
      paragraphs: [
        `You have been asked to review “${s.title}” (${s.reference}).`,
        dueAt
          ? `The review is due by ${dueAt}. Please accept or decline so the administrator knows where it stands.`
          : "Please accept or decline so the administrator knows where it stands.",
      ],
      cta: "Open the assignment",
    }),

  assignmentCancelled: (s: SubmissionRef) =>
    message("ASSIGNMENT_CANCELLED", {
      title: "Assignment withdrawn",
      body: `${s.reference} has been given to another reviewer.`,
      linkPath: "/reviewer",
      subject: `An assignment was withdrawn (${s.reference})`,
      paragraphs: [
        `“${s.title}” (${s.reference}) has been given to another reviewer, so you no longer need to work on it.`,
      ],
      cta: "Open your queue",
    }),

  deadlineApproaching: (s: SubmissionRef, dueAt: string) =>
    message("DEADLINE_APPROACHING", {
      title: "A review is due soon",
      body: `Your review of ${s.reference} is due by ${dueAt}.`,
      linkPath: reviewerPath(s),
      subject: `Review due ${dueAt} (${s.reference})`,
      paragraphs: [`Your review of “${s.title}” (${s.reference}) is due by ${dueAt}.`],
      cta: "Continue the review",
    }),

  revisionRequested: (s: SubmissionRef) =>
    message("REVISION_REQUESTED", {
      title: "Changes requested on your review",
      body: `The administrator has asked for changes to your review of ${s.reference}.`,
      linkPath: reviewerPath(s),
      subject: `Changes requested on your review (${s.reference})`,
      paragraphs: [
        `The administrator has read your review of “${s.title}” (${s.reference}) and asked for changes before it goes to the author.`,
        "Their note is shown at the top of the review. Your answers are still there to edit.",
      ],
      cta: "Open the review",
    }),
};

// ── To administrators ──────────────────────────────────────────────────────

export const toAdmin = {
  submissionCreated: (s: SubmissionRef) =>
    message("SUBMISSION_CREATED", {
      title: "New submission",
      body: `${s.reference} needs a reviewer.`,
      linkPath: adminPath(s),
      subject: `New submission needs a reviewer (${s.reference})`,
      paragraphs: [`“${s.title}” (${s.reference}) has been submitted and needs a reviewer.`],
      cta: "Assign a reviewer",
    }),

  assignmentAccepted: (s: SubmissionRef) =>
    message("ASSIGNMENT_ANSWERED", {
      title: "Assignment accepted",
      body: `The reviewer accepted ${s.reference}.`,
      linkPath: adminPath(s),
      subject: `Assignment accepted (${s.reference})`,
      paragraphs: [`The reviewer has accepted “${s.title}” (${s.reference}).`],
      cta: "View the submission",
    }),

  assignmentDeclined: (s: SubmissionRef) =>
    message("ASSIGNMENT_ANSWERED", {
      title: "Assignment declined",
      body: `The reviewer declined ${s.reference}. It needs a new reviewer.`,
      linkPath: adminPath(s),
      subject: `Assignment declined — needs a new reviewer (${s.reference})`,
      paragraphs: [
        `The reviewer has declined “${s.title}” (${s.reference}). Their reason is on the submission.`,
        "It is back in the queue and needs a new reviewer.",
      ],
      cta: "Assign a reviewer",
    }),

  reviewSubmitted: (s: SubmissionRef, revised: boolean) =>
    message("REVIEW_SUBMITTED", {
      title: revised ? "Revised review ready for approval" : "Review ready for approval",
      body: `The ${revised ? "revised " : ""}review of ${s.reference} is waiting for you.`,
      linkPath: adminPath(s),
      subject: `${revised ? "Revised review" : "Review"} ready for approval (${s.reference})`,
      paragraphs: [
        `The ${revised ? "revised " : ""}review of “${s.title}” (${s.reference}) has been submitted and is waiting for your approval.`,
        "The author will not see it until you approve it.",
      ],
      cta: "Read the review",
    }),

  reviewOverdue: (s: SubmissionRef, dueAt: string) =>
    message("REVIEW_OVERDUE", {
      title: "A review is overdue",
      body: `The review of ${s.reference} was due by ${dueAt}.`,
      linkPath: adminPath(s),
      subject: `Review overdue (${s.reference})`,
      paragraphs: [
        `The review of “${s.title}” (${s.reference}) was due by ${dueAt} and has not been submitted.`,
        "You can remind the reviewer or reassign it.",
      ],
      cta: "View the submission",
    }),
};
