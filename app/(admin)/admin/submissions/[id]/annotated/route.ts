import { NextResponse } from "next/server";
import { adminAnnotatedDownloadUrl } from "@/lib/approvals";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";

/** Downloads the reviewer's annotated (scrubbed) file, for an administrator. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/submissions/[id]/annotated">,
) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session || session.user.role !== "ADMIN" || !isUuid(id)) {
    return new Response(null, { status: 404 });
  }

  const url = await adminAnnotatedDownloadUrl(id);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
