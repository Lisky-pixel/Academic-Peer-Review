import type { SessionUser } from "@/lib/auth/session";
import {
  INVOICE_DUE_DAYS,
  CURRENCY,
  type Package,
  packageFor,
  packageLimitLabel,
} from "@/lib/billing/pricing";
import { recordPayment, uniqueSlug } from "@/lib/conferences";
import { type ConferenceInput, formatMoney } from "@/lib/conferences/schema";
import { db } from "@/lib/db";
import { kickEmailDispatch } from "@/lib/email/outbox";
import { formatDate } from "@/lib/format";
import type { Prisma } from "@/lib/generated/prisma/client";
import { queueNotices } from "@/lib/notifications";
import { toAdministrators, toRequester } from "@/lib/notifications/messages";

/**
 * Conference requests and their invoices.
 *
 *   1. An organiser requests a conference. It is stored PENDING, they are
 *      attached as its organiser, and an invoice for the package that fits
 *      the papers they expect is issued and emailed to them at once.
 *   2. They pay outside the platform, quoting the invoice number.
 *   3. An administrator marks the invoice paid, which records the payment
 *      and emails a receipt (lib/conferences recordPayment).
 *   4. An administrator approves the conference, which makes it live, or
 *      declines it with a reason.
 *
 * Nothing here takes money. Online payment would replace step 3 only.
 */

// ── Payment instructions ───────────────────────────────────────────────────

const INSTRUCTIONS_KEY = "paymentInstructions";

const DEFAULT_INSTRUCTIONS =
  "Our team will contact you with bank transfer details. If you have not heard from us within one working day, reply through the help page.";

/** How organisers should pay, as the administrator wrote it. */
export async function paymentInstructions(): Promise<string> {
  const setting = await db.appSetting.findUnique({ where: { key: INSTRUCTIONS_KEY } });
  return typeof setting?.value === "string" && setting.value.trim()
    ? setting.value
    : DEFAULT_INSTRUCTIONS;
}

export async function savePaymentInstructions(admin: SessionUser, text: string): Promise<void> {
  const value = text.trim().slice(0, 4000);
  await db.appSetting.upsert({
    where: { key: INSTRUCTIONS_KEY },
    create: { key: INSTRUCTIONS_KEY, value },
    update: { value },
  });
  await db.activityLog.create({
    data: {
      action: "billing.instructions_updated",
      entityType: "User",
      entityId: admin.id,
      actorId: admin.id,
      actorRole: admin.role,
    },
  });
}

// ── Requesting a conference ────────────────────────────────────────────────

async function allocateInvoiceNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "InvoiceCounter" ("year", "lastValue") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "lastValue" = "InvoiceCounter"."lastValue" + 1
    RETURNING "lastValue"
  `;
  return `APR-INV-${year}-${String(rows[0]!.lastValue).padStart(4, "0")}`;
}

function packageDescription(pkg: Package, conferenceName: string): string {
  return `${pkg.name} package (${packageLimitLabel(pkg).toLowerCase()}) for ${conferenceName}`;
}

/**
 * An organiser asks for a conference. The package and paper limit come from
 * the expected number of papers, never from the form directly.
 */
export async function requestConference(
  organiser: SessionUser,
  input: ConferenceInput,
  expectedPapers: number,
): Promise<{ conferenceId: string; invoiceId: string }> {
  const pkg = packageFor(expectedPapers);
  const instructions = await paymentInstructions();
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    const conference = await tx.conference.create({
      data: {
        ...input,
        slug: await uniqueSlug(tx, input.name),
        status: "PENDING",
        expectedPapers,
        packageName: pkg.name,
        submissionLimit: pkg.maxPapers,
        requestedById: organiser.id,
        organisers: { create: { userId: organiser.id } },
      },
      select: { id: true, name: true },
    });

    const invoice = await tx.invoice.create({
      data: {
        number: await allocateInvoiceNumber(tx, now),
        conferenceId: conference.id,
        billedToName: organiser.name,
        billedToEmail: organiser.email,
        description: packageDescription(pkg, conference.name),
        amountMinor: pkg.priceMinor,
        currency: CURRENCY,
        dueAt: new Date(now.getTime() + INVOICE_DUE_DAYS * 86_400_000),
      },
      select: { id: true, number: true, dueAt: true },
    });

    await tx.activityLog.create({
      data: {
        action: "conference.requested",
        entityType: "Conference",
        entityId: conference.id,
        actorId: organiser.id,
        actorRole: organiser.role,
        metadata: { invoice: invoice.number, package: pkg.name, expectedPapers },
      },
    });

    const amount = formatMoney(pkg.priceMinor, CURRENCY);
    const admins = await tx.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true },
    });
    await queueNotices(tx, [
      {
        userId: organiser.id,
        message: toRequester.invoiceIssued({
          invoiceId: invoice.id,
          number: invoice.number,
          conferenceId: conference.id,
          conferenceName: conference.name,
          packageName: `${pkg.name} (${packageLimitLabel(pkg).toLowerCase()})`,
          amount,
          dueOn: formatDate(invoice.dueAt),
          paymentInstructions: instructions,
        }),
      },
      ...admins.map((admin) => ({
        userId: admin.id,
        message: toAdministrators.conferenceRequested({
          conferenceId: conference.id,
          conferenceName: conference.name,
          organiserName: organiser.name,
          amount,
          invoiceNumber: invoice.number,
        }),
      })),
    ]);

    return { conferenceId: conference.id, invoiceId: invoice.id };
  });

  kickEmailDispatch();
  return result;
}

// ── Settling, approving, declining ─────────────────────────────────────────

export type InvoiceFailure = "not_found" | "not_unpaid";

/** Records that an invoice was paid; the organisers are emailed a receipt. */
export async function markInvoicePaid(
  admin: SessionUser,
  invoiceId: string,
  input: { paidAt: Date; reference: string | null },
): Promise<{ ok: true; receiptNumber: string } | { ok: false; reason: InvoiceFailure }> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      status: true,
      conferenceId: true,
      amountMinor: true,
      currency: true,
      description: true,
      number: true,
    },
  });
  if (!invoice) return { ok: false, reason: "not_found" };
  if (invoice.status !== "UNPAID") return { ok: false, reason: "not_unpaid" };

  const result = await recordPayment(
    admin,
    invoice.conferenceId,
    {
      amount: invoice.amountMinor,
      currency: invoice.currency as "USD",
      description: `${invoice.description} (invoice ${invoice.number})`,
      reference: input.reference,
      paidAt: input.paidAt,
    },
    invoiceId,
  );
  return result.ok ? result : { ok: false, reason: "not_found" };
}

export type DecisionFailure = "not_found" | "not_pending";

async function decideRequest(
  admin: SessionUser,
  conferenceId: string,
  approve: boolean,
  reason: string,
): Promise<{ ok: true } | { ok: false; reason: DecisionFailure }> {
  const result = await db.$transaction(async (tx) => {
    const conference = await tx.conference.findUnique({
      where: { id: conferenceId },
      select: { id: true, name: true, status: true, submissionsOpenAt: true },
    });
    if (!conference) return { ok: false, reason: "not_found" } as const;

    // The status is part of the WHERE, so two administrators cannot both decide.
    const { count } = await tx.conference.updateMany({
      where: { id: conferenceId, status: "PENDING" },
      data: approve
        ? { status: "ACTIVE", approvedAt: new Date() }
        : { status: "DECLINED", declineReason: reason },
    });
    if (count !== 1) return { ok: false, reason: "not_pending" } as const;

    if (!approve) {
      await tx.invoice.updateMany({
        where: { conferenceId, status: "UNPAID" },
        data: { status: "VOID" },
      });
    }

    await tx.activityLog.create({
      data: {
        action: approve ? "conference.approved" : "conference.declined",
        entityType: "Conference",
        entityId: conferenceId,
        actorId: admin.id,
        actorRole: admin.role,
        metadata: approve ? {} : { reason },
      },
    });

    const organisers = await tx.conferenceOrganiser.findMany({
      where: { conferenceId },
      select: { userId: true },
    });
    const message = approve
      ? toRequester.approved({
          conferenceId,
          conferenceName: conference.name,
          opensOn: formatDate(
            conference.submissionsOpenAt > new Date() ? conference.submissionsOpenAt : new Date(),
          ),
        })
      : toRequester.declined({ conferenceId, conferenceName: conference.name, reason });
    await queueNotices(
      tx,
      organisers.map((row) => ({ userId: row.userId, message })),
    );
    return { ok: true } as const;
  });
  if (result.ok) kickEmailDispatch();
  return result;
}

export function approveConference(admin: SessionUser, conferenceId: string) {
  return decideRequest(admin, conferenceId, true, "");
}

export function declineConference(admin: SessionUser, conferenceId: string, reason: string) {
  return decideRequest(admin, conferenceId, false, reason.trim().slice(0, 1000));
}

// ── Reading ────────────────────────────────────────────────────────────────

const INVOICE_SELECT = {
  id: true,
  number: true,
  billedToName: true,
  billedToEmail: true,
  description: true,
  amountMinor: true,
  currency: true,
  status: true,
  issuedAt: true,
  dueAt: true,
  paidAt: true,
  conference: { select: { id: true, name: true, status: true } },
  payment: { select: { receiptNumber: true, reference: true } },
} satisfies Prisma.InvoiceSelect;

function toInvoiceDTO(row: Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SELECT }>) {
  return {
    id: row.id,
    number: row.number,
    billedToName: row.billedToName,
    billedToEmail: row.billedToEmail,
    description: row.description,
    amount: formatMoney(row.amountMinor, row.currency),
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    conference: row.conference,
    receiptNumber: row.payment?.receiptNumber ?? null,
  };
}

export type InvoiceDTO = ReturnType<typeof toInvoiceDTO>;

/**
 * One invoice, for an administrator or an organiser of its conference.
 * Anyone else gets null, which pages turn into "not found".
 */
export async function findInvoiceFor(
  viewer: SessionUser,
  invoiceId: string,
): Promise<InvoiceDTO | null> {
  const row = await db.invoice.findFirst({
    where: {
      id: invoiceId,
      ...(viewer.role === "ADMIN"
        ? {}
        : { conference: { organisers: { some: { userId: viewer.id } } } }),
    },
    select: INVOICE_SELECT,
  });
  return row ? toInvoiceDTO(row) : null;
}

export async function findConferenceInvoices(conferenceId: string): Promise<InvoiceDTO[]> {
  const rows = await db.invoice.findMany({
    where: { conferenceId },
    orderBy: { issuedAt: "desc" },
    select: INVOICE_SELECT,
  });
  return rows.map(toInvoiceDTO);
}

export async function findAllInvoices(): Promise<InvoiceDTO[]> {
  const rows = await db.invoice.findMany({
    orderBy: { issuedAt: "desc" },
    take: 200,
    select: INVOICE_SELECT,
  });
  return rows.map(toInvoiceDTO);
}

/** Requests waiting for an administrator, with where their invoice stands. */
export async function findConferenceRequests() {
  const rows = await db.conference.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      expectedPapers: true,
      packageName: true,
      requestedBy: { select: { name: true, email: true } },
      invoices: {
        orderBy: { issuedAt: "desc" },
        take: 1,
        select: { number: true, status: true, amountMinor: true, currency: true },
      },
    },
  });
  return rows.map((row) => {
    const invoice = row.invoices[0];
    return {
      id: row.id,
      name: row.name,
      requestedAt: row.createdAt.toISOString(),
      expectedPapers: row.expectedPapers,
      packageName: row.packageName,
      requestedBy: row.requestedBy,
      invoice: invoice
        ? {
            number: invoice.number,
            status: invoice.status,
            amount: formatMoney(invoice.amountMinor, invoice.currency),
          }
        : null,
    };
  });
}
