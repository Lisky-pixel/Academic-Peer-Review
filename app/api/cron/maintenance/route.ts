import { hashToken, safeCompareHex } from "@/lib/auth/tokens";
import { env } from "@/lib/env";
import { runMaintenance } from "@/lib/maintenance";

/**
 * The scheduled maintenance endpoint, called by Vercel Cron (see vercel.json).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`. Anything else gets a
 * 401 and nothing runs: this endpoint sends email and deletes rows, so it
 * must not be something a passer-by can trigger.
 */

// Reminders and retries can take a while; this is not a page.
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  // Compared as digests so the comparison takes the same time whatever was
  // sent, and so the two sides are always the same length.
  return safeCompareHex(hashToken(presented), hashToken(env.CRON_SECRET));
}

export async function GET(request: Request) {
  if (!authorised(request)) return new Response(null, { status: 401 });

  const report = await runMaintenance();
  console.log("Maintenance run", report);
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
