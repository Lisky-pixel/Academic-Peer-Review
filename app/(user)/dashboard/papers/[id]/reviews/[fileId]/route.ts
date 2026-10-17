import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";
import { ownReviewFileUrl } from "@/lib/submissions";

/**
 * Downloads a reviewer's marked-up copy of the submitter's paper, once the
 * paper has been decided. Only scrubbed files are ever served here.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/dashboard/papers/[id]/reviews/[fileId]">,
) {
  const { id, fileId } = await params;

  const session = await getCurrentSession();
  if (!session || !isUuid(id) || !isUuid(fileId)) return new Response(null, { status: 404 });

  const url = await ownReviewFileUrl(session.user.id, id, fileId);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
