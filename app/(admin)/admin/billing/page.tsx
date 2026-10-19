import type { Metadata } from "next";
import Link from "next/link";
import { PaymentInstructionsForm } from "@/app/(admin)/admin/billing/forms";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { requireRole } from "@/lib/auth/guards";
import { findAllInvoices, paymentInstructions } from "@/lib/billing";
import { CURRENCY, PACKAGES, packageLimitLabel } from "@/lib/billing/pricing";
import { formatMoney } from "@/lib/conferences/schema";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Billing" };

const STATUS = {
  UNPAID: { label: "Unpaid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Cancelled", tone: "muted" },
} as const;

export default async function BillingPage() {
  const user = await requireRole("ADMIN");
  const [invoices, instructions] = await Promise.all([findAllInvoices(), paymentInstructions()]);

  return (
    <RoleArea
      user={user}
      title="Billing"
      description="Packages, how organisers pay you, and every invoice issued."
      current="/admin/billing"
    >
      <section className="glass space-y-4 rounded-2xl p-5 sm:p-6">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-medium">Packages</h2>
          <p className="text-muted-foreground text-sm">
            Set by the papers an organiser expects. Prices are in{" "}
            <code className="text-xs">lib/billing/pricing.ts</code>.
          </p>
        </div>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PACKAGES.map((pkg) => (
            <li key={pkg.id} className="border-border rounded-xl border p-4">
              <p className="font-medium">{pkg.name}</p>
              <p className="text-muted-foreground text-sm">{packageLimitLabel(pkg)}</p>
              <p className="font-heading mt-2 text-2xl font-medium tabular-nums">
                {formatMoney(pkg.priceMinor, CURRENCY)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="glass space-y-4 rounded-2xl p-5 sm:p-6">
        <h2 className="font-heading text-xl font-medium">Payment instructions</h2>
        <PaymentInstructionsForm initial={instructions} />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-medium">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            No invoices yet. One is issued whenever an organiser requests a conference.
          </p>
        ) : (
          <div className="glass overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Every invoice issued</caption>
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Invoice
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Conference
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Issued
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <Link
                        href={`/organiser/invoices/${invoice.id}`}
                        className="text-mark font-mono underline-offset-4 hover:underline"
                      >
                        {invoice.number}
                      </Link>
                      <span className="text-muted-foreground block">{invoice.billedToName}</span>
                    </th>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/conferences/${invoice.conference.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {invoice.conference.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(invoice.issuedAt)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {invoice.amount}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={STATUS[invoice.status].tone}>
                        {STATUS[invoice.status].label}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </RoleArea>
  );
}
