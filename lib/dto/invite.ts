import type { PendingInviteRecord } from "@/lib/auth/invites";

/**
 * A pending invitation as the admin sees it. Dates are ISO strings so the
 * object can cross to a client component unchanged.
 */
export type PendingInviteDTO = {
  id: string;
  name: string;
  email: string;
  role: "REVIEWER" | "ADMIN";
  invitedAt: string;
  /** Null when no link is outstanding. */
  linkExpiresAt: string | null;
  /** True when the invitee can no longer use their link and needs a new one. */
  linkExpired: boolean;
};

export function toPendingInviteDTO(
  record: PendingInviteRecord,
  now: Date = new Date(),
): PendingInviteDTO {
  const expiresAt = record.tokens[0]?.expiresAt ?? null;
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role === "ADMIN" ? "ADMIN" : "REVIEWER",
    invitedAt: record.createdAt.toISOString(),
    linkExpiresAt: expiresAt?.toISOString() ?? null,
    linkExpired: !expiresAt || expiresAt.getTime() <= now.getTime(),
  };
}
