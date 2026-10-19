import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { FormMessage } from "@/components/form";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { requireRole } from "@/lib/auth/guards";
import { findInvoiceFor, paymentInstructions } from "@/lib/billing";
import { env } from "@/lib/env";
import { formatDate, isUuid } from "@/lib/format";

export const metadata: Metadata = { title: "Invoice" };

const STATUS = {
  UNPAID: { label: "Unpaid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Cancelled", tone: "muted" },
} as const;

/**
 * An invoice, as a page that prints cleanly: the browser's "Save as PDF" turns
 * it into the document an organiser's finance office expects.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: PageProps<"/organiser/invoices/[id]">) {
  const user = await requireRole("ORGANISER", "ADMIN");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [invoice, instructions, { requested }] = await Promise.all([
    findInvoiceFor(user, id),
    paymentInstructions(),
    searchParams,
  ]);
  if (!invoice) notFound();
  const status = STATUS[invoice.status];

  return (
    <RoleArea
      user={user}
      title={`Invoice ${invoice.number}`}
      description={invoice.conference.name}
      actions={<PrintButton />}
    >
      {requested && (
        <FormMessage tone="success" className="print:hidden">
          Your request has been sent, and this invoice has been emailed to you. Once it is paid, we
          will approve your conference.
        </FormMessage>
      )}

      <article className="glass print-sheet space-y-8 rounded-3xl p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-heading text-2xl font-semibold">{env.APP_NAME}</p>
            <p className="text-muted-foreground text-sm">
              {env.APP_URL.replace(/^https?:\/\//, "")}
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading text-3xl font-medium">Invoice</p>
            <p className="font-mono text-sm">{invoice.number}</p>
            <div className="mt-2">
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
          </div>
        </header>

        <dl className="grid grid-cols-[minmax(0,1fr)] gap-6 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Billed to</dt>
            <dd className="font-medium">{invoice.billedToName}</dd>
            <dd>{invoice.billedToEmail}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Issued</dt>
            <dd className="font-medium">{formatDate(invoice.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{invoice.paidAt ? "Paid" : "Due by"}</dt>
            <dd className="font-medium">{formatDate(invoice.paidAt ?? invoice.dueAt)}</dd>
          </div>
        </dl>

        <table className="w-full text-sm">
          <caption className="sr-only">What this invoice is for</caption>
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left">
              <th scope="col" className="py-2 font-medium">
                Description
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-border border-b">
              <td className="py-3 pr-4">{invoice.description}</td>
              <td className="py-3 text-right whitespace-nowrap tabular-nums">{invoice.amount}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="pt-4 text-left font-medium">
                Total {invoice.status === "PAID" ? "paid" : "due"}
              </th>
              <td className="font-heading pt-4 text-right text-2xl font-medium tabular-nums">
                {invoice.amount}
              </td>
            </tr>
          </tfoot>
        </table>

        {invoice.status === "UNPAID" && (
          <section className="border-border space-y-2 border-t pt-6 text-sm">
            <h2 className="font-medium">How to pay</h2>
            <p className="leading-relaxed whitespace-pre-line">{instructions}</p>
            <p className="text-muted-foreground">
              Please quote <span className="font-mono">{invoice.number}</span> as your payment
              reference.
            </p>
          </section>
        )}
        {invoice.status === "PAID" && invoice.receiptNumber && (
          <p className="border-border text-muted-foreground border-t pt-6 text-sm">
            Paid with thanks. Receipt <span className="font-mono">{invoice.receiptNumber}</span>.
          </p>
        )}
        {invoice.status === "VOID" && (
          <p className="border-border text-muted-foreground border-t pt-6 text-sm">
            This invoice was cancelled because the conference request was not approved. Nothing is
            owed.
          </p>
        )}
      </article>
    </RoleArea>
  );
}
