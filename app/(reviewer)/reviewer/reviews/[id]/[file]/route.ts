import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";
import { reviewerFileUrl } from "@/lib/reviews";

/**
 * Downloads a file from a submission the reviewer currently holds:
 * `/document` for the author's document, `/annotated` for the reviewer's own
 * scrubbed copy. Redirects to a short-lived signed storage URL.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/reviewer/reviews/[id]/[file]">,
) {
  const { id, file } = await params;

  const session = await getCurrentSession();
  const which = file === "document" ? "original" : file === "annotated" ? "annotated" : null;
  if (!session || session.user.role !== "REVIEWER" || !isUuid(id) || !which) {
    return new Response(null, { status: 404 });
  }

  const url = await reviewerFileUrl(session.user.id, id, which);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
