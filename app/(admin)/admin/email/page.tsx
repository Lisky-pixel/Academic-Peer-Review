import type { Metadata } from "next";
import { TestEmailForm } from "@/app/(admin)/admin/email/test-form";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { StatusPill } from "@/components/status-pill";
import {
  emailCounts,
  emailSettings,
  explainEmailError,
  findRecentEmails,
} from "@/lib/admin/email-log";
import { requireRole } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Email" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const TONE = { SENT: "success", FAILED: "warning", QUEUED: "progress" } as const;

export default async function EmailPage() {
  const user = await requireRole("ADMIN");
  const [emails, counts] = await Promise.all([
    findRecentEmails(),
    emailCounts(new Date(Date.UTC(2000, 0, 1))),
  ]);
  const settings = emailSettings();
  const lastFailure = emails.find((email) => email.status === "FAILED" && email.error);
  const advice = lastFailure?.error ? explainEmailError(lastFailure.error) : null;

  return (
    <RoleArea
      user={user}
      title="Email"
      description="Every email the platform sent or tried to send, newest first, and a test to check delivery."
      current="/admin/email"
    >
      <StatTiles
        stats={[
          { label: "Sent", value: counts.sent },
          { label: "Failed", value: counts.failed, tone: "attention" },
          { label: "Waiting to send", value: counts.queued },
        ]}
      />

      {lastFailure && (
        <section className="glass space-y-2 rounded-2xl p-5 sm:p-6">
          <h2 className="font-medium">The most recent failure</h2>
          {advice && <p className="leading-relaxed">{advice}</p>}
          <p className="text-muted-foreground font-mono text-xs break-words">{lastFailure.error}</p>
        </section>
      )}

      <section className="glass space-y-5 rounded-2xl p-5 sm:p-6">
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Provider</dt>
            <dd className="font-medium">{settings.provider}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sent from (EMAIL_FROM)</dt>
            <dd className="font-medium break-words">{settings.from}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Resend API key</dt>
            <dd className="font-medium">{settings.keySet ? "Set" : "Missing"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Links in emails point to (APP_URL)</dt>
            <dd className="font-medium break-words">{settings.appUrl}</dd>
          </div>
        </dl>
        <TestEmailForm defaultTo={user.email} />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-medium">Recent emails</h2>
        {emails.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            Nothing has been sent yet.
          </p>
        ) : (
          <ul className="glass divide-border divide-y overflow-hidden rounded-2xl">
            {emails.map((email) => (
              <li key={email.id} className="space-y-1 px-5 py-3.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 font-medium break-words">{email.subject}</span>
                  <StatusPill tone={TONE[email.status]}>
                    {email.status === "SENT"
                      ? "Sent"
                      : email.status === "FAILED"
                        ? "Failed"
                        : "Waiting"}
                  </StatusPill>
                </div>
                <p className="text-muted-foreground">
                  To {email.toEmail} · {dateTime.format(new Date(email.createdAt))} UTC
                  {email.attempts > 1 && ` · ${email.attempts} attempts`}
                </p>
                {email.error && (
                  <p className="text-warning font-mono text-xs break-words">{email.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </RoleArea>
  );
}
