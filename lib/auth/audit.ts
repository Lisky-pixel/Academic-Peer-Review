import { db } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/client";

export type AuthEvent =
  | "auth.login"
  | "auth.registered"
  | "auth.password_reset"
  | "auth.password_changed"
  | "auth.invite_sent"
  | "auth.invite_cancelled"
  | "auth.invite_accepted";

/**
 * Records an account event in the activity log.
 *
 * Never throws: an audit write failing must not turn a successful login into
 * an error page. The failure is logged for the operator instead.
 */
export async function logAuthEvent(
  action: AuthEvent,
  subject: { id: string; role: Role },
  options: { ip?: string | null; actor?: { id: string; role: Role } } = {},
): Promise<void> {
  const actor = options.actor ?? subject;
  try {
    await db.activityLog.create({
      data: {
        action,
        entityType: "User",
        entityId: subject.id,
        actorId: actor.id,
        actorRole: actor.role,
        ip: options.ip ?? null,
      },
    });
  } catch (error) {
    console.error(`Failed to write activity log entry "${action}"`, error);
  }
}
