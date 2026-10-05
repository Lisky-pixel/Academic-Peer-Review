import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";
import { ownDocumentDownloadUrl } from "@/lib/submissions";

/**
 * Downloads the author's own uploaded document.
 *
 * Checks who is asking, then redirects to a signed storage URL that expires
 * in minutes and forces a download. The file is never served from this
 * origin, so it can never be rendered as a page of ours.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/dashboard/submissions/[id]/document">,
) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session || session.user.role !== "USER" || !isUuid(id)) {
    return new Response(null, { status: 404 });
  }

  const url = await ownDocumentDownloadUrl(session.user.id, id);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
