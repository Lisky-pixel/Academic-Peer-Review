import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import type { SessionUser } from "@/lib/auth/session";
import { canOrganise } from "@/lib/conferences";
import { isUuid } from "@/lib/format";

/**
 * The guard for every organiser page and action about one conference: the
 * signed-in person must be an administrator, or an organiser attached to it.
 * Anyone else gets "not found", so conference ids cannot be probed.
 */
export async function requireOrganiserOf(conferenceId: string): Promise<SessionUser> {
  const user = await requireRole("ORGANISER", "ADMIN");
  if (!isUuid(conferenceId) || !(await canOrganise(user, conferenceId))) notFound();
  return user;
}
