// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const deliver = vi.hoisted(() =>
  vi.fn<
    (message: { to: string; subject: string; html?: string; text: string }) => Promise<string>
  >(),
);
vi.mock("@/lib/email", () => ({ deliver }));

import { assignReviewer } from "@/lib/assignments";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dispatchQueuedEmails, kickEmailDispatch, MAX_ATTEMPTS } from "@/lib/email/outbox";
import { toBellDTO } from "@/lib/dto/notification";
import type { Role, UserStatus } from "@/lib/generated/prisma/client";
import { escalateOverdueReviews, sendDeadlineReminders } from "@/lib/maintenance";
import {
  findBellNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";
import { toAuthor } from "@/lib/notifications/messages";
import { acceptAssignment } from "@/lib/reviews";
import { createDraft, submitDraft } from "@/lib/submissions";
import { dbAvailable, purgeUsers, testEmail } from "@/lib/test/db";

const REVIEWER_NAME = "Zebediah Quillfeather";
const DAY = 86_400_000;

const createdUserIds: string[] = [];
const createdEmails: string[] = [];

/** Only this file's mail: the dev database may hold real queued messages. */
const mine = () => ({ toEmail: { in: createdEmails } });

async function createUser(
  role: Role,
  name: string,
  status: UserStatus = "ACTIVE",
): Promise<SessionUser> {
  const user = await db.user.create({
    data: { email: testEmail(role.toLowerCase()), name, role, status },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  createdUserIds.push(user.id);
  createdEmails.push(user.email);
  return user;
}

const documentTypeId = dbAvailable
  ? (await db.documentType.findFirstOrThrow({ where: { slug: "personal-statement" } })).id
  : "";

/** A submitted document, optionally assigned with a due date. */
async function scenario(options: { dueInDays?: number } = {}) {
  const author = await createUser("USER", "Test Author");
  const admin = await createUser("ADMIN", "Test Admin");
  const reviewer = await createUser("REVIEWER", REVIEWER_NAME);

  const draft = await createDraft(author, {
    title: "Personal statement",
    documentTypeId,
    purpose: null,
    description: null,
    instructions: null,
    focusAreas: null,
    deadline: null,
  });
  if (!draft.ok) throw new Error("draft failed");
  await db.storedFile.create({
    data: {
      submissionId: draft.id,
      kind: "ORIGINAL",
      storageKey: `test/${draft.id}`,
      originalFilename: "statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      checksum: "0".repeat(64),
      uploadedById: author.id,
    },
  });
  await submitDraft(author, draft.id);

  if (options.dueInDays !== undefined) {
    await assignReviewer({ submissionId: draft.id, reviewerId: reviewer.id, admin });
    await db.assignment.updateMany({
      where: { submissionId: draft.id },
      data: { dueAt: new Date(Date.now() + options.dueInDays * DAY) },
    });
  }
  return { author, admin, reviewer, id: draft.id };
}

const emailsTo = (email: string) =>
  db.emailLog.findMany({ where: { toEmail: email }, orderBy: { createdAt: "asc" } });

beforeEach(() => {
  deliver.mockReset();
  deliver.mockResolvedValue("provider-id-1");
});

afterAll(async () => {
  if (dbAvailable) await purgeUsers(createdUserIds);
});

describe.skipIf(!dbAvailable)("workflow events queue the right mail", () => {
  it("submitting tells the author and every administrator, in the bell and by email", async () => {
    const { author, admin, id } = await scenario();

    const authorMail = await emailsTo(author.email);
    expect(authorMail).toHaveLength(1);
    expect(authorMail[0]).toMatchObject({
      template: "SUBMISSION_RECEIVED",
      status: "QUEUED",
      submissionId: id,
      attempts: 0,
    });
    expect(authorMail[0]!.subject).toMatch(/^We have your submission \(RF-\d{4}-\d+\)$/);

    expect((await emailsTo(admin.email)).map((mail) => mail.template)).toEqual([
      "SUBMISSION_CREATED",
    ]);

    const bell = toBellDTO(await findBellNotifications(author.id));
    expect(bell).toMatchObject({ unread: 1 });
    expect(bell.items[0]).toMatchObject({ title: "We have your submission", read: false });
  });

  it("assigning tells the author and the reviewer — and tells neither about the other", async () => {
    const { author, reviewer } = await scenario({ dueInDays: 10 });

    const authorMail = await emailsTo(author.email);
    const reviewerMail = await emailsTo(reviewer.email);

    expect(authorMail.map((mail) => mail.template)).toEqual([
      "SUBMISSION_RECEIVED",
      "SUBMISSION_STATUS_CHANGED",
    ]);
    expect(reviewerMail.map((mail) => mail.template)).toEqual(["ASSIGNMENT_RECEIVED"]);

    const toTheAuthor = JSON.stringify(authorMail);
    expect(toTheAuthor).not.toContain(REVIEWER_NAME);
    expect(toTheAuthor).not.toContain(reviewer.email);
    expect(toTheAuthor).not.toContain(reviewer.id);

    const toTheReviewer = JSON.stringify(reviewerMail);
    expect(toTheReviewer).not.toContain(author.name);
    expect(toTheReviewer).not.toContain(author.email);
  });

  it("queues nothing for a person who can no longer sign in", async () => {
    const { id } = await scenario();
    const suspended = await createUser("ADMIN", "Suspended Admin", "SUSPENDED");

    // Another submission, made after the suspension.
    await scenario();

    expect(await emailsTo(suspended.email)).toEqual([]);
    expect(await db.notification.count({ where: { userId: suspended.id } })).toBe(0);
    expect(id).toBeTruthy();
  });

  it("does not send anything by itself during tests", async () => {
    await scenario();
    kickEmailDispatch();

    expect(deliver).not.toHaveBeenCalled();
  });
});

describe.skipIf(!dbAvailable)("the outbox", () => {
  it("renders and sends queued mail, then marks it sent", async () => {
    const { author } = await scenario();

    const summary = await dispatchQueuedEmails(50, mine());

    expect(summary.failed).toBe(0);
    expect(summary.sent).toBeGreaterThanOrEqual(2);
    const sentToAuthor = deliver.mock.calls.map(([m]) => m).find((m) => m.to === author.email)!;
    expect(sentToAuthor.subject).toMatch(/^We have your submission/);
    expect(sentToAuthor.html).toContain("/dashboard/submissions/");
    expect(sentToAuthor.text).toContain("waiting to be matched with a reviewer");

    const [row] = await emailsTo(author.email);
    expect(row).toMatchObject({ status: "SENT", attempts: 1, providerId: "provider-id-1" });
    expect(row!.sentAt).toBeInstanceOf(Date);
    expect(row!.nextAttemptAt).toBeNull();
  });

  it("does not send the same message twice", async () => {
    const { author } = await scenario();

    await dispatchQueuedEmails(50, mine());
    await dispatchQueuedEmails(50, mine());

    expect(deliver.mock.calls.filter(([m]) => m.to === author.email)).toHaveLength(1);
  });

  it("sends each message once even when two dispatchers run at the same moment", async () => {
    const { author } = await scenario();

    await Promise.all([dispatchQueuedEmails(50, mine()), dispatchQueuedEmails(50, mine())]);

    expect(deliver.mock.calls.filter(([m]) => m.to === author.email)).toHaveLength(1);
  });

  it("records a failure, waits, and then succeeds on a later attempt", async () => {
    const { author } = await scenario();
    const only = { toEmail: author.email };
    deliver.mockRejectedValueOnce(new Error("SMTP connection refused"));

    expect(await dispatchQueuedEmails(50, only)).toEqual({ sent: 0, failed: 1 });
    let [row] = await emailsTo(author.email);
    expect(row).toMatchObject({ status: "FAILED", attempts: 1, error: "SMTP connection refused" });
    expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // Too soon: the back-off has not elapsed.
    expect(await dispatchQueuedEmails(50, only)).toEqual({ sent: 0, failed: 0 });

    await db.emailLog.updateMany({ where: only, data: { nextAttemptAt: new Date(0) } });
    expect(await dispatchQueuedEmails(50, only)).toEqual({ sent: 1, failed: 0 });
    [row] = await emailsTo(author.email);
    expect(row).toMatchObject({ status: "SENT", attempts: 2, error: null });
  });

  it("gives up after the maximum number of attempts", async () => {
    const { author } = await scenario();
    const only = { toEmail: author.email };
    deliver.mockRejectedValue(new Error("mailbox unavailable"));

    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await db.emailLog.updateMany({ where: only, data: { nextAttemptAt: new Date(0) } });
      await dispatchQueuedEmails(50, only);
    }

    const [row] = await emailsTo(author.email);
    expect(row).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    expect(deliver).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("never resends an account email, which is logged without a body", async () => {
    const user = await createUser("USER", "Reset Requester");
    await db.emailLog.create({
      data: {
        toEmail: user.email,
        template: "password-reset",
        subject: "Reset your password",
        status: "FAILED",
        attempts: 1,
      },
    });

    await dispatchQueuedEmails(50, { toEmail: user.email });

    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips a row whose stored content is malformed instead of crashing the run", async () => {
    const { author } = await scenario();
    const broken = await createUser("USER", "Broken Payload");
    await db.emailLog.create({
      data: {
        toEmail: broken.email,
        template: "REVIEW_READY",
        subject: "Broken",
        payload: { nonsense: true },
      },
    });

    const summary = await dispatchQueuedEmails(50, {
      toEmail: { in: [author.email, broken.email] },
    });

    expect(summary).toEqual({ sent: 1, failed: 0 });
  });
});

describe.skipIf(!dbAvailable)("the bell", () => {
  it("marks one notification read and returns where it leads", async () => {
    const { author, id } = await scenario();
    const { items } = await findBellNotifications(author.id);

    const link = await markNotificationRead(author.id, items[0]!.id);

    expect(link).toBe(`/dashboard/submissions/${id}`);
    expect(toBellDTO(await findBellNotifications(author.id))).toMatchObject({
      unread: 0,
      items: [{ read: true }],
    });
  });

  it("will not open, or reveal the target of, somebody else's notification", async () => {
    const { author } = await scenario();
    const stranger = await createUser("USER", "A Stranger");
    const { items } = await findBellNotifications(author.id);

    expect(await markNotificationRead(stranger.id, items[0]!.id)).toBeNull();
    expect((await findBellNotifications(author.id)).unread).toBe(1);
  });

  it("marks everything read at once, for that person only", async () => {
    const first = await scenario({ dueInDays: 10 });
    const second = await scenario();

    expect(await markAllNotificationsRead(first.author.id)).toBe(2);

    expect((await findBellNotifications(first.author.id)).unread).toBe(0);
    expect((await findBellNotifications(second.author.id)).unread).toBe(1);
  });

  it("gives the browser no link to trust: the DTO has none", async () => {
    const { author } = await scenario();

    const bell = toBellDTO(await findBellNotifications(author.id));

    expect(Object.keys(bell.items[0]!).sort()).toEqual(
      ["body", "createdAt", "id", "read", "title"].sort(),
    );
  });
});

describe.skipIf(!dbAvailable)("deadline reminders", () => {
  const only = (id: string) => ({ submissionId: id });

  it("reminds the reviewer once when a review is due within the lead time", async () => {
    // The Phase 8 exit criterion: fires correctly against near-deadline data.
    const { reviewer, id } = await scenario({ dueInDays: 1 });
    await acceptAssignment(reviewer, id);

    expect(await sendDeadlineReminders(new Date(), only(id))).toBe(1);

    const reminders = (await emailsTo(reviewer.email)).filter(
      (mail) => mail.template === "DEADLINE_APPROACHING",
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.subject).toMatch(/^Review due \d{1,2} \w{3} \d{4} \(RF-/);
    const notice = await db.notification.findFirstOrThrow({
      where: { userId: reviewer.id, submissionId: id, type: "DEADLINE_APPROACHING" },
    });
    expect(notice.linkUrl).toBe(`/reviewer/reviews/${id}`);
  });

  it("does not remind again on the next run", async () => {
    const { reviewer, id } = await scenario({ dueInDays: 1 });

    await sendDeadlineReminders(new Date(), only(id));
    expect(await sendDeadlineReminders(new Date(), only(id))).toBe(0);
    await Promise.all([
      sendDeadlineReminders(new Date(), only(id)),
      sendDeadlineReminders(new Date(), only(id)),
    ]);

    expect(
      await db.notification.count({
        where: { userId: reviewer.id, submissionId: id, type: "DEADLINE_APPROACHING" },
      }),
    ).toBe(1);
  });

  it("leaves alone a review that is not due soon, or is already overdue", async () => {
    const far = await scenario({ dueInDays: 20 });
    const late = await scenario({ dueInDays: -1 });

    expect(await sendDeadlineReminders(new Date(), only(far.id))).toBe(0);
    expect(await sendDeadlineReminders(new Date(), only(late.id))).toBe(0);
  });

  it("does not remind about a submission that has been cancelled", async () => {
    const { id } = await scenario({ dueInDays: 1 });
    // Not through the state machine: this test is about the job's filter.
    await db.assignment.updateMany({ where: { submissionId: id }, data: { status: "COMPLETED" } });

    expect(await sendDeadlineReminders(new Date(), only(id))).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("overdue escalation", () => {
  const only = (id: string) => ({ submissionId: id });

  it("tells each administrator once that a review is overdue", async () => {
    const { admin, reviewer, id } = await scenario({ dueInDays: -2 });

    expect(await escalateOverdueReviews(new Date(), only(id))).toBe(1);
    expect(await escalateOverdueReviews(new Date(), only(id))).toBe(0);

    const overdue = (await emailsTo(admin.email)).filter(
      (mail) => mail.template === "REVIEW_OVERDUE",
    );
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.subject).toMatch(/^Review overdue \(RF-/);
    // The reviewer is not the one being escalated to.
    expect(
      (await emailsTo(reviewer.email)).some((mail) => mail.template === "REVIEW_OVERDUE"),
    ).toBe(false);
  });

  it("does not escalate a review that is still within its time", async () => {
    const { id } = await scenario({ dueInDays: 3 });

    expect(await escalateOverdueReviews(new Date(), only(id))).toBe(0);
  });

  it("escalates again if the submission is reassigned and the new reviewer is late too", async () => {
    const { admin, id } = await scenario({ dueInDays: -2 });
    await escalateOverdueReviews(new Date(), only(id));

    // A fresh assignment, made now and already past due.
    const replacement = await createUser("REVIEWER", "Replacement");
    await db.assignment.updateMany({
      where: { submissionId: id },
      data: { isActive: null, status: "CANCELLED" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.assignment.create({
      data: {
        submissionId: id,
        reviewerId: replacement.id,
        assignedById: admin.id,
        isActive: true,
        dueAt: new Date(Date.now() - DAY),
      },
    });

    expect(await escalateOverdueReviews(new Date(), only(id))).toBe(1);
  });
});

describe("message builders used by the workflow", () => {
  it("are the ones the tests above matched on", () => {
    const ref = { id: "x", reference: "RF-2026-0001", title: "T" };
    expect(toAuthor.submissionReceived(ref).email.subject).toBe(
      "We have your submission (RF-2026-0001)",
    );
  });
});

describe.skipIf(!dbAvailable)("a queue longer than one round", () => {
  it("is worked through in a single run, not left for the next one", async () => {
    // One event can notify many administrators at once. A dispatcher that
    // took a fixed slice left the overflow unsent until something else
    // happened to queue mail.
    const user = await createUser("USER", "Many Messages");
    await db.emailLog.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        toEmail: user.email,
        template: "REVIEW_READY",
        subject: `Message ${index}`,
        payload: { heading: "Hello", paragraphs: ["Text"], cta: null },
      })),
    });

    const summary = await dispatchQueuedEmails(200, { toEmail: user.email });

    expect(summary).toEqual({ sent: 60, failed: 0 });
    expect(await db.emailLog.count({ where: { toEmail: user.email, status: "SENT" } })).toBe(60);
  });

  it("stops at its limit, leaving the rest queued", async () => {
    const user = await createUser("USER", "Limited Run");
    await db.emailLog.createMany({
      data: Array.from({ length: 40 }, (_, index) => ({
        toEmail: user.email,
        template: "REVIEW_READY",
        subject: `Message ${index}`,
        payload: { heading: "Hello", paragraphs: ["Text"], cta: null },
      })),
    });

    expect(await dispatchQueuedEmails(30, { toEmail: user.email })).toEqual({
      sent: 30,
      failed: 0,
    });
    expect(await db.emailLog.count({ where: { toEmail: user.email, status: "QUEUED" } })).toBe(10);
  });

  it("does not loop forever on rows it cannot send", async () => {
    const user = await createUser("USER", "All Broken");
    await db.emailLog.createMany({
      data: Array.from({ length: 30 }, () => ({
        toEmail: user.email,
        template: "REVIEW_READY",
        subject: "Broken",
        payload: { nonsense: true },
      })),
    });

    expect(await dispatchQueuedEmails(200, { toEmail: user.email })).toEqual({
      sent: 0,
      failed: 0,
    });
  });
});
