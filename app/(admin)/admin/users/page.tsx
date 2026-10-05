import { UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { reactivateUserAction } from "@/app/(admin)/admin/users/actions";
import { SuspendButton } from "@/app/(admin)/admin/users/suspend-button";
import { RoleArea } from "@/components/role-area";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findUsers } from "@/lib/admin/users";
import { requireRole } from "@/lib/auth/guards";
import { ROLE_LABEL, toAdminUserDTO, USER_STATUS_LABEL } from "@/lib/dto/admin";
import { formatDate } from "@/lib/format";
import type { Role, UserStatus } from "@/lib/generated/prisma/client";
import type { Tone } from "@/lib/submissions/stage";

export const metadata: Metadata = { title: "People" };

const ROLES: Role[] = ["USER", "REVIEWER", "ADMIN"];
const STATUSES: UserStatus[] = ["ACTIVE", "INVITED", "UNVERIFIED", "SUSPENDED"];

const STATUS_TONE: Record<UserStatus, Tone> = {
  ACTIVE: "success",
  INVITED: "progress",
  UNVERIFIED: "neutral",
  SUSPENDED: "muted",
};

const SELECT =
  "border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 h-9 min-w-0 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3";

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requireRole("ADMIN");

  const params = await searchParams;
  const role = ROLES.find((candidate) => candidate === params.role);
  const status = STATUSES.find((candidate) => candidate === params.status);
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const filtered = Boolean(role || status || query);

  const users = (await findUsers({ role, status, query })).map(toAdminUserDTO);

  return (
    <RoleArea
      user={admin}
      title="People"
      description="Everyone with an account. Accounts are suspended rather than deleted, so their work and history stay intact."
      current="/admin/users"
      actions={
        <Button asChild size="lg" className="h-10 px-4 text-sm">
          <Link href="/admin/invites">
            <UserPlus aria-hidden />
            Invite someone
          </Link>
        </Button>
      }
    >
      <div className="space-y-5">
        <form method="get" action="/admin/users" className="flex flex-wrap items-center gap-2">
          <Input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search by name or email"
            aria-label="Search by name or email"
            className="h-9 sm:max-w-64"
          />
          <select name="role" defaultValue={role ?? ""} aria-label="Role" className={SELECT}>
            <option value="">Any role</option>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}s
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className={SELECT}>
            <option value="">Any status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {USER_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="lg">
            Filter
          </Button>
          {filtered && (
            <Button asChild variant="ghost" size="lg">
              <Link href="/admin/users">Clear</Link>
            </Button>
          )}
        </form>

        {users.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-14 text-center text-sm">
            Nobody matches those filters.
          </p>
        ) : (
          <ul className="glass divide-border divide-y rounded-2xl">
            {users.map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0 flex-1 basis-64 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{user.name}</span>
                    {user.id === admin.id && (
                      <span className="text-muted-foreground text-sm font-normal">(you)</span>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">{user.email}</p>
                  <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    <span>Joined {formatDate(user.joinedAt)}</span>
                    {user.lastSeenAt && <span>Last seen {formatDate(user.lastSeenAt)}</span>}
                    {user.role === "USER" && (
                      <span>
                        {user.submissions} submission{user.submissions === 1 ? "" : "s"}
                      </span>
                    )}
                    {user.role === "REVIEWER" && (
                      <span>
                        {user.openReviews} review{user.openReviews === 1 ? "" : "s"} in progress
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="neutral">{ROLE_LABEL[user.role]}</StatusPill>
                  <StatusPill tone={STATUS_TONE[user.status]}>
                    {USER_STATUS_LABEL[user.status]}
                  </StatusPill>
                </div>

                <div className="basis-full sm:basis-auto sm:text-right">
                  {user.status === "ACTIVE" && user.id !== admin.id && (
                    <SuspendButton
                      userId={user.id}
                      name={user.name}
                      openReviews={user.openReviews}
                    />
                  )}
                  {user.status === "SUSPENDED" && (
                    <form action={reactivateUserAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Reactivate
                      </Button>
                    </form>
                  )}
                  {user.status === "INVITED" && (
                    <Link
                      href="/admin/invites"
                      className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
                    >
                      Manage invitation
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </RoleArea>
  );
}
