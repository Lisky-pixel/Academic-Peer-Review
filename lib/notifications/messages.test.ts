// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseEmailContent, renderNotificationEmail } from "@/lib/email/template";
import { type Message, toAdmin, toAuthor, toReviewer } from "@/lib/notifications/messages";

const SUBMISSION = {
  id: "00000000-0000-7000-8000-000000000147",
  reference: "RF-2026-0147",
  title: "Personal statement for MSc Transport Planning",
};
const SITE = { appName: "ReviewFlow", appUrl: "https://reviewflow.example" };

const AUTHOR: Array<[string, Message]> = [
  ["submission received", toAuthor.submissionReceived(SUBMISSION)],
  ["reviewer assigned", toAuthor.reviewerAssigned(SUBMISSION)],
  ["review ready", toAuthor.reviewReady(SUBMISSION)],
  ["cancelled", toAuthor.cancelled(SUBMISSION)],
];
const REVIEWER: Array<[string, Message]> = [
  ["assignment received", toReviewer.assignmentReceived(SUBMISSION, "14 Oct 2026")],
  ["assignment received, no due date", toReviewer.assignmentReceived(SUBMISSION, null)],
  ["assignment cancelled", toReviewer.assignmentCancelled(SUBMISSION)],
  ["deadline approaching", toReviewer.deadlineApproaching(SUBMISSION, "14 Oct 2026")],
  ["revision requested", toReviewer.revisionRequested(SUBMISSION)],
];
const ADMIN: Array<[string, Message]> = [
  ["submission created", toAdmin.submissionCreated(SUBMISSION)],
  ["assignment accepted", toAdmin.assignmentAccepted(SUBMISSION)],
  ["assignment declined", toAdmin.assignmentDeclined(SUBMISSION)],
  ["review submitted", toAdmin.reviewSubmitted(SUBMISSION, false)],
  ["revised review submitted", toAdmin.reviewSubmitted(SUBMISSION, true)],
  ["review overdue", toAdmin.reviewOverdue(SUBMISSION, "14 Oct 2026")],
];
const ALL = [...AUTHOR, ...REVIEWER, ...ADMIN];

describe("every message", () => {
  it.each(ALL)("%s: quotes the reference in the bell and the subject", (_name, message) => {
    expect(message.body).toContain(SUBMISSION.reference);
    expect(message.email.subject).toContain(SUBMISSION.reference);
    expect(message.title.length).toBeGreaterThan(5);
  });

  it.each(ALL)("%s: the email button goes where the notification goes", (_name, message) => {
    expect(message.email.content.cta?.path).toBe(message.linkPath);
    expect(message.linkPath).toMatch(/^\/(dashboard|reviewer|admin)/);
  });

  it.each(ALL)("%s: survives being stored as JSON and read back", (_name, message) => {
    const stored = JSON.parse(JSON.stringify(message.email.content));
    expect(parseEmailContent(stored)).toEqual(message.email.content);
  });

  it.each(ALL)("%s: renders to HTML and plain text with an absolute link", async (_n, message) => {
    const { html, text } = await renderNotificationEmail(message.email.content, SITE);
    const url = `${SITE.appUrl}${message.linkPath}`;

    expect(html).toContain(url);
    expect(text).toContain(url);
    // The plain-text renderer sets headings in capitals.
    expect(text.toLowerCase()).toContain(message.email.content.heading.toLowerCase());
    expect(text).toContain("ReviewFlow");
    // No template syntax or undefined values leaking into what people read.
    expect(html + text).not.toMatch(/undefined|\[object Object\]|\$\{/);
  });
});

describe("each audience is sent to its own area", () => {
  it.each(AUTHOR)("author — %s", (_name, message) => {
    expect(message.linkPath).toBe(`/dashboard/submissions/${SUBMISSION.id}`);
  });

  it.each(ADMIN)("admin — %s", (_name, message) => {
    expect(message.linkPath).toBe(`/admin/submissions/${SUBMISSION.id}`);
  });

  it.each(REVIEWER)("reviewer — %s", (_name, message) => {
    expect(message.linkPath).toMatch(/^\/reviewer/);
  });
});

describe("what the author is told", () => {
  it.each(AUTHOR)("%s: never sends the author into the reviewer or admin areas", (_n, message) => {
    const everything = JSON.stringify(message);
    expect(everything).not.toContain("/reviewer");
    expect(everything).not.toContain("/admin");
  });

  it("tells the author the reviewer is anonymous when one is assigned", () => {
    const { paragraphs } = toAuthor.reviewerAssigned(SUBMISSION).email.content;
    expect(paragraphs.join(" ")).toContain("anonymous");
  });

  it("uses the same notification type for the two status changes the author hears about", () => {
    expect(toAuthor.reviewerAssigned(SUBMISSION).type).toBe("SUBMISSION_STATUS_CHANGED");
    expect(toAuthor.cancelled(SUBMISSION).type).toBe("SUBMISSION_STATUS_CHANGED");
    expect(toAuthor.reviewReady(SUBMISSION).type).toBe("REVIEW_READY");
  });
});

describe("parseEmailContent", () => {
  it.each([
    ["nothing", null],
    ["a string", "hello"],
    ["a missing heading", { paragraphs: [] }],
    ["paragraphs that are not strings", { heading: "Hi", paragraphs: [1, 2] }],
    ["paragraphs that are not a list", { heading: "Hi", paragraphs: "text" }],
  ])("rejects %s", (_label, value) => {
    expect(parseEmailContent(value)).toBeNull();
  });

  it("drops a button whose link is not a path on this site", () => {
    const content = parseEmailContent({
      heading: "Hi",
      paragraphs: ["Text"],
      cta: { label: "Click", path: "https://evil.example/phish" },
    });

    expect(content).toEqual({ heading: "Hi", paragraphs: ["Text"], cta: null });
  });
});
