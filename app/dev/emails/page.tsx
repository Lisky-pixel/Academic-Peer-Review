import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { renderNotificationEmail } from "@/lib/email/template";
import { type Message, toOrganiser, toReviewer, toSubmitter } from "@/lib/notifications/messages";

export const metadata: Metadata = { title: "Email previews" };

/**
 * Every notification email, rendered with sample data, for checking wording
 * and layout without triggering the events. Development only: in production
 * this route does not exist.
 */

const SAMPLE = {
  id: "00000000-0000-7000-8000-000000000147",
  reference: "APR-2026-0147",
  title: "Mobile money adoption among smallholder farmers in Northern Ghana",
  conferenceId: "00000000-0000-7000-8000-000000000001",
};
const CONFERENCE = "African Conference on Sustainable Development 2026";

const GROUPS: Array<{ audience: string; messages: Array<[string, Message]> }> = [
  {
    audience: "To the submitter",
    messages: [
      ["Paper received", toSubmitter.submissionReceived(SAMPLE, CONFERENCE)],
      ["Accepted", toSubmitter.decisionMade(SAMPLE, true, CONFERENCE)],
      ["Not accepted", toSubmitter.decisionMade(SAMPLE, false, CONFERENCE)],
    ],
  },
  {
    audience: "To the reviewer",
    messages: [
      ["Paper assigned", toReviewer.assignmentReceived(SAMPLE, "14 Dec 2026")],
      ["Review no longer needed", toReviewer.assignmentCancelled(SAMPLE)],
      ["Reminder: 7 days", toReviewer.deadlineApproaching(SAMPLE, "14 Dec 2026", 7)],
      ["Reminder: 1 day", toReviewer.deadlineApproaching(SAMPLE, "14 Dec 2026", 1)],
    ],
  },
  {
    audience: "To organisers",
    messages: [
      ["Needs reviewers", toOrganiser.needsReviewers(SAMPLE, 1)],
      ["Reviews complete", toOrganiser.reviewsComplete(SAMPLE)],
      ["Review overdue", toOrganiser.reviewOverdue(SAMPLE, "14 Dec 2026")],
      [
        "Payment receipt",
        toOrganiser.paymentReceipt({
          conferenceId: SAMPLE.conferenceId,
          conferenceName: CONFERENCE,
          receiptNumber: "APR-R-2026-0007",
          amount: "NGN 250,000.00",
          description: "Standard package, 2026 edition",
          paidOn: "16 Oct 2026",
          reference: "TRF-88412",
        }),
      ],
    ],
  },
];

const slug = (label: string) => label.toLowerCase().replace(/\s+/g, "-");

export default async function EmailPreviewsPage({ searchParams }: PageProps<"/dev/emails">) {
  if (process.env.NODE_ENV !== "development") notFound();

  const { t } = await searchParams;
  const all = GROUPS.flatMap((group) => group.messages);
  const [label, message] = all.find(([name]) => slug(name) === t) ?? all[0]!;
  const { html, text } = await renderNotificationEmail(message.email.content, {
    appName: "Academic Peer Review",
    appUrl: "http://localhost:3000",
  });

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 px-5 py-10 md:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Email templates" className="space-y-6 text-sm">
        <h1 className="font-heading text-xl font-medium">Email previews</h1>
        {GROUPS.map((group) => (
          <div key={group.audience} className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium">{group.audience}</p>
            <ul className="space-y-0.5">
              {group.messages.map(([name]) => (
                <li key={name}>
                  <Link
                    href={`/dev/emails?t=${slug(name)}`}
                    aria-current={name === label ? "page" : undefined}
                    className="hover:bg-muted aria-[current=page]:bg-muted block rounded-md px-2 py-1 aria-[current=page]:font-medium"
                  >
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <main className="min-w-0 space-y-6">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Subject</p>
          <p className="font-medium">{message.email.subject}</p>
        </div>
        <iframe
          title={`${label} email`}
          sandbox=""
          srcDoc={html}
          className="border-border h-[34rem] w-full rounded-xl border bg-white"
        />
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Plain-text version</summary>
          <pre className="border-border bg-card mt-3 overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {text}
          </pre>
        </details>
        <div className="border-border space-y-1 border-t pt-5 text-sm">
          <p className="text-muted-foreground text-xs">In the notification bell</p>
          <p className="font-medium">{message.title}</p>
          <p className="text-muted-foreground">{message.body}</p>
        </div>
      </main>
    </div>
  );
}
