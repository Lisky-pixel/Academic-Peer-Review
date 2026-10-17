import { FileText } from "lucide-react";
import type { Metadata } from "next";
import {
  inviteReviewerAction,
  resendReviewerInviteAction,
} from "@/app/(organiser)/organiser/actions";
import { InviteForm } from "@/components/invite-form";
import { RoleArea } from "@/components/role-area";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { findReviewerPool } from "@/lib/conferences/pool";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Reviewers" };

/**
 * The reviewer pool, for organisers: who can review, in which disciplines,
 * and an invitation form for bringing more people in.
 */
export default async function ReviewersPage() {
  const user = await requireRole("ORGANISER", "ADMIN");

  const { reviewers, invited } = await findReviewerPool();

  return (
    <RoleArea
      user={user}
      title="Reviewers"
      description="Everyone who can be matched to papers. Reviewers can sign up themselves, or you can invite them."
      current="/organiser/reviewers"
    >
      <section className="glass rounded-2xl p-6">
        <h2 className="font-heading text-xl font-medium">Invite a reviewer</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          They choose a password, then add their disciplines so papers can be matched to them.
        </p>
        <div className="mt-5">
          <InviteForm send={inviteReviewerAction} roles={["REVIEWER"]} />
        </div>
      </section>

      {invited.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-medium">Invited, not yet joined</h2>
          <ul className="glass divide-border divide-y overflow-hidden rounded-2xl">
            {invited.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">{person.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {person.email} · invited {formatDate(person.invitedAt)}
                  </span>
                </span>
                <form action={resendReviewerInviteAction}>
                  <input type="hidden" name="userId" value={person.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Resend
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-medium">
          The pool <span className="text-muted-foreground text-base">({reviewers.length})</span>
        </h2>
        {reviewers.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            No reviewers yet.
          </p>
        ) : (
          <div className="glass overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Reviewers who can be matched to papers</caption>
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Reviewer
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Disciplines
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Rank
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    CV
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {reviewers.map((reviewer) => (
                  <tr key={reviewer.id}>
                    <th scope="row" className="px-5 py-3 text-left align-top">
                      <span className="block font-medium">{reviewer.name}</span>
                      <span className="text-muted-foreground block font-normal">
                        {reviewer.institution ?? "—"}
                      </span>
                    </th>
                    <td className="px-4 py-3 align-top">
                      {reviewer.profile ? (
                        reviewer.profile.disciplines.join(", ")
                      ) : (
                        <span className="text-warning">Profile not completed</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      {reviewer.profile
                        ? `${reviewer.profile.rank} · ${reviewer.profile.years} yrs`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {reviewer.profile?.hasCv ? (
                        <a
                          href={`/organiser/reviewers/${reviewer.id}/cv`}
                          className="text-mark inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                        >
                          <FileText aria-hidden className="size-4" />
                          CV
                        </a>
                      ) : (
                        "—"
                      )}
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
