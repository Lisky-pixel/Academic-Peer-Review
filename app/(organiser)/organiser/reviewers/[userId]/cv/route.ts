import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/format";
import { cvDownloadUrl } from "@/lib/profile";

/** Downloads a reviewer's CV: for the reviewer, organisers and administrators. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/organiser/reviewers/[userId]/cv">,
) {
  const { userId } = await params;
  const session = await getCurrentSession();
  if (!session || !isUuid(userId)) return new Response(null, { status: 404 });

  const url = await cvDownloadUrl(session.user, userId);
  if (!url) return new Response(null, { status: 404 });

  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
