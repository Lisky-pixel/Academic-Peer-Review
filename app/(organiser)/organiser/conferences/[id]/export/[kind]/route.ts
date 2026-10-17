import { getCurrentSession } from "@/lib/auth/guards";
import { canOrganise, findConference } from "@/lib/conferences";
import { exportPapers, exportReviews } from "@/lib/conferences/reports";
import { slugify } from "@/lib/conferences/schema";
import { isUuid } from "@/lib/format";

/**
 * A conference's papers or reviews as a CSV file that opens in Excel. For
 * the conference's organisers and administrators only: the reviews export
 * names every reviewer.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/organiser/conferences/[id]/export/[kind]">,
) {
  const { id, kind } = await params;

  const session = await getCurrentSession();
  if (!session || !isUuid(id) || (kind !== "papers" && kind !== "reviews")) {
    return new Response(null, { status: 404 });
  }
  if (!(await canOrganise(session.user, id))) return new Response(null, { status: 404 });

  const conference = await findConference(id);
  if (!conference) return new Response(null, { status: 404 });

  const csv = kind === "papers" ? await exportPapers(id) : await exportReviews(id);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(conference.name)}-${kind}-${date}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
