// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import {
  approveConference,
  declineConference,
  findInvoiceFor,
  markInvoicePaid,
  requestConference,
} from "@/lib/billing";
import { db } from "@/lib/db";
import { findOpenConferences } from "@/lib/submissions";
import { cleanUpTestUsers, dbAvailable, testEmail } from "@/lib/test/db";

/** A conference request, its invoice, payment, and the administrator's decision. */

const TAG = randomUUID().slice(0, 8);
const DAY = 86_400_000;

async function person(role: "ORGANISER" | "ADMIN" | "USER"): Promise<SessionUser> {
  return db.user.create({
    data: { email: testEmail(role.toLowerCase()), name: `${role} ${TAG}`, role, status: "ACTIVE" },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
}

function input(name: string) {
  return {
    name,
    description: null,
    venue: null,
    startsOn: null,
    endsOn: null,
    submissionsOpenAt: new Date(Date.now() - DAY),
    submissionsCloseAt: new Date(Date.now() + 10 * DAY),
    reviewDeadline: new Date(Date.now() + 30 * DAY),
    reviewersPerPaper: 2,
    maxPapersPerReviewer: 4,
    doubleBlind: true,
    submissionFormat: "FULL_PAPER" as const,
    topics: ["Testing"],
    packageName: null,
    submissionLimit: null,
  };
}

describe.skipIf(!dbAvailable)("conference requests", () => {
  let organiser: SessionUser;
  let admin: SessionUser;
  const conferenceIds: string[] = [];

  beforeAll(async () => {
    organiser = await person("ORGANISER");
    admin = await person("ADMIN");
  });

  afterAll(async () => {
    await db.payment.deleteMany({ where: { conferenceId: { in: conferenceIds } } });
    await db.invoice.deleteMany({ where: { conferenceId: { in: conferenceIds } } });
    await db.conference.deleteMany({ where: { id: { in: conferenceIds } } });
    await cleanUpTestUsers();
  });

  it("is pending, priced by the papers expected, and invoiced at once", async () => {
    const { conferenceId, invoiceId } = await requestConference(
      organiser,
      input(`Requested ${TAG}`),
      40,
    );
    conferenceIds.push(conferenceId);

    const conference = await db.conference.findUniqueOrThrow({ where: { id: conferenceId } });
    expect(conference).toMatchObject({
      status: "PENDING",
      packageName: "Starter",
      submissionLimit: 50,
      requestedById: organiser.id,
    });
    expect(
      await db.conferenceOrganiser.count({ where: { conferenceId, userId: organiser.id } }),
    ).toBe(1);

    const invoice = await findInvoiceFor(organiser, invoiceId);
    expect(invoice).toMatchObject({ status: "UNPAID", amountMinor: 1000, currency: "USD" });
    expect(invoice!.number).toMatch(/^APR-INV-\d{4}-\d{4}$/);

    // Emailed to the organiser, and the administrators are told.
    expect(
      await db.notification.count({
        where: { userId: organiser.id, type: "CONFERENCE_REQUESTED" },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { userId: admin.id, type: "CONFERENCE_REQUESTED" } }),
    ).toBe(1);
  });

  it("takes no papers and is invisible to submitters until approved", async () => {
    const open = await findOpenConferences();
    expect(open.map((c) => c.id)).not.toContain(conferenceIds[0]);
  });

  it("keeps the invoice from anyone but its organisers and administrators", async () => {
    const invoice = await db.invoice.findFirstOrThrow({
      where: { conferenceId: conferenceIds[0] },
    });
    const stranger = await person("ORGANISER");
    expect(await findInvoiceFor(stranger, invoice.id)).toBeNull();
    expect(await findInvoiceFor(admin, invoice.id)).not.toBeNull();
  });

  it("records the payment with a receipt, then goes live when approved", async () => {
    const invoice = await db.invoice.findFirstOrThrow({
      where: { conferenceId: conferenceIds[0] },
    });
    const paid = await markInvoicePaid(admin, invoice.id, {
      paidAt: new Date(),
      reference: "TRF-1",
    });
    expect(paid).toMatchObject({ ok: true });
    expect(
      await markInvoicePaid(admin, invoice.id, { paidAt: new Date(), reference: null }),
    ).toEqual({ ok: false, reason: "not_unpaid" });
    const payment = await db.payment.findUniqueOrThrow({ where: { invoiceId: invoice.id } });
    expect(payment.amountMinor).toBe(1000);

    expect(await approveConference(admin, conferenceIds[0]!)).toEqual({ ok: true });
    expect(await approveConference(admin, conferenceIds[0]!)).toEqual({
      ok: false,
      reason: "not_pending",
    });
    const open = await findOpenConferences();
    expect(open.map((c) => c.id)).toContain(conferenceIds[0]);
  });

  it("cancels the invoice when a request is declined", async () => {
    const { conferenceId, invoiceId } = await requestConference(
      organiser,
      input(`Declined ${TAG}`),
      300,
    );
    conferenceIds.push(conferenceId);
    expect(
      (await db.conference.findUniqueOrThrow({ where: { id: conferenceId } })).packageName,
    ).toBe("Professional");

    expect(await declineConference(admin, conferenceId, "Could not confirm payment.")).toEqual({
      ok: true,
    });
    const conference = await db.conference.findUniqueOrThrow({ where: { id: conferenceId } });
    expect(conference).toMatchObject({
      status: "DECLINED",
      declineReason: "Could not confirm payment.",
    });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("VOID");
  });
});
