import { NextResponse } from "next/server";
import { ownReviewedFileUrl } from "@/lib/approvals";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";

/**
 * Downloads the annotated copy of the author's own submission.
 *
 * Only an approved review's file is ever offered, and only one that has been
 * scrubbed of the reviewer's identity — both conditions live in the query in
 * lib/approvals, not here. Downloading counts as receiving the review.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/dashboard/submissions/[id]/reviewed">,
) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session || session.user.role !== "USER" || !isUuid(id)) {
    return new Response(null, { status: 404 });
  }

  const url = await ownReviewedFileUrl(session.user.id, id);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
