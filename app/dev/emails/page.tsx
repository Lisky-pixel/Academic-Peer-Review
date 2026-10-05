import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { renderNotificationEmail } from "@/lib/email/template";
import { type Message, toAdmin, toAuthor, toReviewer } from "@/lib/notifications/messages";

export const metadata: Metadata = { title: "Email previews" };

/**
 * Every notification email, rendered with sample data, for checking wording
 * and layout without triggering the events. Development only: in production
 * this route does not exist.
 */

const SAMPLE = {
  id: "00000000-0000-7000-8000-000000000147",
  reference: "RF-2026-0147",
  title: "Personal statement for MSc Transport Planning",
};

const GROUPS: Array<{ audience: string; messages: Array<[string, Message]> }> = [
  {
    audience: "To the author",
    messages: [
      ["Submission received", toAuthor.submissionReceived(SAMPLE)],
      ["Reviewer assigned", toAuthor.reviewerAssigned(SAMPLE)],
      ["Review ready", toAuthor.reviewReady(SAMPLE)],
      ["Submission cancelled", toAuthor.cancelled(SAMPLE)],
    ],
  },
  {
    audience: "To the reviewer",
    messages: [
      ["Assignment received", toReviewer.assignmentReceived(SAMPLE, "14 Oct 2026")],
      ["Assignment withdrawn", toReviewer.assignmentCancelled(SAMPLE)],
      ["Deadline approaching", toReviewer.deadlineApproaching(SAMPLE, "14 Oct 2026")],
      ["Revision requested", toReviewer.revisionRequested(SAMPLE)],
    ],
  },
  {
    audience: "To administrators",
    messages: [
      ["Submission created", toAdmin.submissionCreated(SAMPLE)],
      ["Assignment accepted", toAdmin.assignmentAccepted(SAMPLE)],
      ["Assignment declined", toAdmin.assignmentDeclined(SAMPLE)],
      ["Review submitted", toAdmin.reviewSubmitted(SAMPLE, false)],
      ["Revised review submitted", toAdmin.reviewSubmitted(SAMPLE, true)],
      ["Review overdue", toAdmin.reviewOverdue(SAMPLE, "14 Oct 2026")],
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
    appName: "ReviewFlow",
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
