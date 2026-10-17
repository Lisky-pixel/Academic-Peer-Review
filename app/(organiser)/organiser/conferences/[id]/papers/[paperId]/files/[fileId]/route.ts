import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/guards";
import { canOrganise, organiserFileUrl } from "@/lib/conferences";
import { isUuid } from "@/lib/format";

/** Downloads a paper or a reviewer's marked-up copy, for the conference's organisers. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/organiser/conferences/[id]/papers/[paperId]/files/[fileId]">,
) {
  const { id, paperId, fileId } = await params;

  const session = await getCurrentSession();
  if (!session || !isUuid(id) || !isUuid(paperId) || !isUuid(fileId)) {
    return new Response(null, { status: 404 });
  }
  if (!(await canOrganise(session.user, id))) return new Response(null, { status: 404 });

  const url = await organiserFileUrl(id, paperId, fileId);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
