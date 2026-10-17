import { describe, expect, it } from "vitest";
import { toOrganiser, toReviewer, toSubmitter } from "./messages";

const PAPER = {
  id: "00000000-0000-7000-8000-000000000001",
  reference: "APR-2026-0001",
  title: "A paper",
  conferenceId: "00000000-0000-7000-8000-0000000000c1",
};

describe("messages", () => {
  it("send the submitter to their paper, with the reference in the subject", () => {
    for (const message of [
      toSubmitter.submissionReceived(PAPER, "The Conference"),
      toSubmitter.decisionMade(PAPER, true, "The Conference"),
      toSubmitter.decisionMade(PAPER, false, "The Conference"),
    ]) {
      expect(message.linkPath).toBe(`/dashboard/papers/${PAPER.id}`);
      expect(message.email.subject).toContain(PAPER.reference);
      expect(message.email.content.cta?.path).toBe(message.linkPath);
    }
  });

  it("word an acceptance and a rejection differently", () => {
    expect(toSubmitter.decisionMade(PAPER, true, "C").title).toMatch(/accepted/);
    expect(toSubmitter.decisionMade(PAPER, false, "C").title).not.toMatch(/accepted\b(?! this)/);
  });

  it("send reviewers and organisers to their own pages", () => {
    expect(toReviewer.assignmentReceived(PAPER, "1 Dec 2026").linkPath).toBe(
      `/reviewer/reviews/${PAPER.id}`,
    );
    expect(toOrganiser.reviewsComplete(PAPER).linkPath).toBe(
      `/organiser/conferences/${PAPER.conferenceId}/papers/${PAPER.id}`,
    );
  });

  it("say tomorrow on the last reminder, and the number of days before", () => {
    expect(toReviewer.deadlineApproaching(PAPER, "1 Dec", 1).title).toBe(
      "A review is due tomorrow",
    );
    expect(toReviewer.deadlineApproaching(PAPER, "1 Dec", 7).title).toBe(
      "A review is due in 7 days",
    );
  });

  it("put the receipt details in the receipt email", () => {
    const message = toOrganiser.paymentReceipt({
      conferenceId: PAPER.conferenceId,
      conferenceName: "The Conference",
      receiptNumber: "APR-R-2026-0001",
      amount: "NGN 1,000.00",
      description: "Package",
      paidOn: "1 Oct 2026",
      reference: null,
    });
    expect(message.email.subject).toContain("APR-R-2026-0001");
    expect(message.email.content.paragraphs.join(" ")).toContain("NGN 1,000.00");
  });
});
