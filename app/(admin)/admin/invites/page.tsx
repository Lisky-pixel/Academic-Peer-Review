import type { Metadata } from "next";
import {
  cancelInviteAction,
  resendInviteAction,
  sendInviteAction,
} from "@/app/(admin)/admin/invites/actions";
import { InviteForm } from "@/components/invite-form";
import { RoleArea } from "@/components/role-area";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { findPendingInvites } from "@/lib/auth/invites";
import { ROLE_LABEL } from "@/lib/dto/admin";
import { toPendingInviteDTO } from "@/lib/dto/invite";

export const metadata: Metadata = { title: "Invitations" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function InvitesPage() {
  const user = await requireRole("ADMIN");
  const invites = (await findPendingInvites()).map((record) => toPendingInviteDTO(record));

  return (
    <RoleArea
      user={user}
      title="Invitations"
      description="Organisers and administrators join only by invitation; reviewers can be invited or sign up themselves. Each link works once and lasts three days."
      current="/admin/invites"
    >
      <section className="glass rounded-2xl p-6">
        <h2 className="font-heading text-xl font-medium">Invite someone</h2>
        <div className="mt-5">
          <InviteForm send={sendInviteAction} roles={["REVIEWER", "ORGANISER", "ADMIN"]} />
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-heading text-xl font-medium">Pending invitations</h2>
          {invites.length > 0 && (
            <span className="text-muted-foreground text-sm tabular-nums">
              {invites.length} waiting
            </span>
          )}
        </div>

        {invites.length === 0 ? (
          <p className="border-border text-muted-foreground mt-4 rounded-xl border border-dashed px-6 py-10 text-center text-sm">
            Nobody is waiting on an invitation.
          </p>
        ) : (
          <ul className="glass divide-border mt-4 divide-y overflow-hidden rounded-2xl">
            {invites.map((invite) => {
              const expired = invite.linkExpired || !invite.linkExpiresAt;
              return (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{invite.name}</span>
                      <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                        {ROLE_LABEL[invite.role]}
                      </span>
                    </p>
                    <p className="text-muted-foreground truncate text-sm">{invite.email}</p>
                    <p
                      className={expired ? "text-warning text-xs" : "text-muted-foreground text-xs"}
                    >
                      {expired
                        ? "Link expired. Resend to issue a new one."
                        : `Link expires ${dateFormat.format(new Date(invite.linkExpiresAt!))}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <form action={resendInviteAction}>
                      <input type="hidden" name="userId" value={invite.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Resend
                      </Button>
                    </form>
                    <form action={cancelInviteAction}>
                      <input type="hidden" name="userId" value={invite.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        Cancel
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </RoleArea>
  );
}
