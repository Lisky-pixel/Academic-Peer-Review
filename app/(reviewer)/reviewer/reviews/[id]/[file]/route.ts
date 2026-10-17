import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";
import { reviewerFileUrl } from "@/lib/reviews";

/**
 * Downloads the paper, or the reviewer's own marked-up copy, for a reviewer
 * the paper has been given to. Redirects to a short-lived signed URL.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/reviewer/reviews/[id]/[file]">,
) {
  const { id, file } = await params;

  const session = await getCurrentSession();
  if (
    !session ||
    session.user.role !== "REVIEWER" ||
    !isUuid(id) ||
    (file !== "paper" && file !== "annotated")
  ) {
    return new Response(null, { status: 404 });
  }

  const url = await reviewerFileUrl(session.user.id, id, file);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
