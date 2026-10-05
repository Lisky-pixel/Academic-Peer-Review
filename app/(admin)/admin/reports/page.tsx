import type { Metadata } from "next";
import { RoleArea } from "@/components/role-area";
import { StatTiles } from "@/components/stat-tiles";
import { WeeklyBars } from "@/components/weekly-bars";
import { findReports, REPORT_DAYS, REPORT_WEEKS } from "@/lib/admin/reports";
import { requireRole } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Reports" };

const days = (value: number | null) => (value === null ? "—" : `${value} d`);

export default async function ReportsPage() {
  const user = await requireRole("ADMIN");
  const reports = await findReports();
  const received = reports.perWeek.reduce((sum, week) => sum + week.count, 0);

  return (
    <RoleArea
      user={user}
      title="Reports"
      description="How much is coming in, how long it takes, and who is doing the reviewing. Worked out from live data each time you open this page."
      current="/admin/reports"
    >
      <section className="space-y-5">
        <div>
          <h2 className="font-heading text-xl font-medium">Submissions received per week</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {received} in the last {REPORT_WEEKS} weeks. Weeks start on Monday.
          </p>
        </div>
        <div className="glass rounded-2xl p-5 sm:p-6">
          <WeeklyBars weeks={reports.perWeek} unit="submission" />
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="font-heading text-xl font-medium">Turnaround</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            From an author submitting to the review being approved, for reviews approved in the last{" "}
            {REPORT_DAYS} days.
          </p>
        </div>
        <StatTiles
          stats={[
            { label: "Reviews approved", value: reports.turnaround.count },
            { label: "Average", value: days(reports.turnaround.averageDays) },
            { label: "Median", value: days(reports.turnaround.medianDays) },
          ]}
          className="lg:grid-cols-3"
        />
        {reports.turnaroundByType.length > 0 && (
          <div className="glass overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Document type
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Approved
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Average
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Median
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y tabular-nums">
                {reports.turnaroundByType.map((row) => (
                  <tr key={row.documentType}>
                    <th scope="row" className="px-5 py-3 font-normal">
                      {row.documentType}
                    </th>
                    <td className="px-3 py-3 text-right">{row.count}</td>
                    <td className="px-3 py-3 text-right">{days(row.averageDays)}</td>
                    <td className="px-5 py-3 text-right">{days(row.medianDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="font-heading text-xl font-medium">Reviewers</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            Reviews handed in over the last {REPORT_DAYS} days, the average time from being assigned
            to handing in, and what each reviewer holds now.
          </p>
        </div>
        {reports.reviewers.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
            There are no active reviewers yet.
          </p>
        ) : (
          <div className="glass overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Reviewer
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Handed in
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Average time
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    In progress
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Overdue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y tabular-nums">
                {reports.reviewers.map((reviewer) => (
                  <tr key={reviewer.id}>
                    <th scope="row" className="px-5 py-3 font-normal">
                      {reviewer.name}
                    </th>
                    <td className="px-3 py-3 text-right">{reviewer.completed}</td>
                    <td className="px-3 py-3 text-right">{days(reviewer.averageDays)}</td>
                    <td className="px-3 py-3 text-right">{reviewer.open}</td>
                    <td
                      className={
                        reviewer.overdue > 0
                          ? "text-warning px-5 py-3 text-right font-medium"
                          : "px-5 py-3 text-right"
                      }
                    >
                      {reviewer.overdue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </RoleArea>
  );
}
