import { NextResponse } from "next/server";
import { adminDocumentDownloadUrl } from "@/lib/assignments";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";

/**
 * Downloads a submitted document, for an administrator. Redirects to a
 * short-lived signed storage URL that forces a download.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/submissions/[id]/document">,
) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session || session.user.role !== "ADMIN" || !isUuid(id)) {
    return new Response(null, { status: 404 });
  }

  const url = await adminDocumentDownloadUrl(id);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
