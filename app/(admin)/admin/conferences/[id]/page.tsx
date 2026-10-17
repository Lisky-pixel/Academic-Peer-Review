import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { removeOrganiserAction } from "@/app/(admin)/admin/conferences/actions";
import { ConferenceForm, OrganiserForms, PaymentForm } from "@/app/(admin)/admin/conferences/forms";
import { BackLink } from "@/components/back-link";
import { FormMessage } from "@/components/form";
import { RoleArea } from "@/components/role-area";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { findConference, findOrganiserAccounts } from "@/lib/conferences";
import { dateInputValue, formatMoney } from "@/lib/conferences/schema";
import { toConferenceDetailDTO } from "@/lib/dto/conference";
import { formatDate, isUuid } from "@/lib/format";

export const metadata: Metadata = { title: "Conference settings" };

export default async function ConferenceSettingsPage({
  params,
  searchParams,
}: PageProps<"/admin/conferences/[id]">) {
  const user = await requireRole("ADMIN");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { created } = await searchParams;

  const [record, accounts] = await Promise.all([findConference(id), findOrganiserAccounts()]);
  if (!record) notFound();
  const conference = toConferenceDetailDTO(record);
  const attached = new Set(conference.organisers.map((person) => person.id));
  const available = accounts
    .filter((person) => !attached.has(person.id))
    .map((person) => ({ id: person.id, name: person.name, email: person.email }));

  return (
    <RoleArea
      user={user}
      title={conference.name}
      eyebrow={<BackLink href="/admin">Conferences</BackLink>}
      description="Settings, organisers and payments."
      actions={
        <Button asChild size="lg">
          <Link href={`/organiser/conferences/${id}`}>
            Papers and reviews
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      }
    >
      {created && (
        <FormMessage tone="success">
          Conference created. Add its organisers below; it opens for papers on{" "}
          {formatDate(conference.opensAt)}.
        </FormMessage>
      )}

      <section aria-labelledby="organisers" className="glass space-y-5 rounded-3xl p-6 sm:p-8">
        <h2 id="organisers" className="font-heading text-xl font-medium">
          Organisers
        </h2>
        {conference.organisers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No organisers yet. Until there are, notices about this conference come to
            administrators.
          </p>
        ) : (
          <ul className="divide-border border-border divide-y rounded-xl border">
            {conference.organisers.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{person.name}</span>{" "}
                  <span className="text-muted-foreground">{person.email}</span>
                </span>
                <form action={removeOrganiserAction}>
                  <input type="hidden" name="conferenceId" value={id} />
                  <input type="hidden" name="userId" value={person.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <OrganiserForms conferenceId={id} organisers={available} />
      </section>

      <section aria-labelledby="payments" className="glass space-y-5 rounded-3xl p-6 sm:p-8">
        <div className="space-y-1">
          <h2 id="payments" className="font-heading text-xl font-medium">
            Payments
          </h2>
          <p className="text-muted-foreground text-sm">
            Record what the organisers paid. Each payment emails them a numbered receipt.
          </p>
        </div>
        {conference.payments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Payments received for this conference</caption>
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Receipt
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Paid
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    For
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {conference.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-2.5 pr-4 font-mono text-xs">{payment.receiptNumber}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{formatDate(payment.paidAt)}</td>
                    <td className="py-2.5 pr-4">{payment.description}</td>
                    <td className="py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatMoney(payment.amountMinor, payment.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaymentForm conferenceId={id} today={dateInputValue(new Date())} />
      </section>

      <section aria-labelledby="settings" className="glass rounded-3xl p-5 sm:p-8">
        <h2 id="settings" className="sr-only">
          Settings
        </h2>
        <ConferenceForm
          conferenceId={id}
          initial={{
            name: conference.name,
            description: conference.description ?? "",
            venue: conference.venue ?? "",
            startsOn: dateInputValue(conference.startsOn),
            endsOn: dateInputValue(conference.endsOn),
            submissionsOpenAt: dateInputValue(conference.opensAt),
            submissionsCloseAt: dateInputValue(conference.closesAt),
            reviewDeadline: dateInputValue(conference.reviewDeadline),
            reviewersPerPaper: String(conference.reviewersPerPaper),
            maxPapersPerReviewer: String(conference.maxPapersPerReviewer),
            doubleBlind: conference.doubleBlind ? "yes" : "no",
            submissionFormat: conference.format,
            topics: conference.topics.join("\n"),
            packageName: conference.packageName ?? "",
            submissionLimit: conference.submissionLimit ? String(conference.submissionLimit) : "",
          }}
        />
      </section>
    </RoleArea>
  );
}
