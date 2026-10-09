export const dynamic = "force-dynamic";
export const metadata = { title: "Comp & Trial Access — Action Center" };

import Link from "next/link";
import {
  getPlanGrantReport,
  summarizePlanGrantReport,
  GRANT_ENDING_SOON_DAYS,
  GRANT_RECENTLY_ENDED_DAYS,
  type PlanGrantReportRow,
} from "@/lib/data/planGrantsReport";
import { GRANT_STATUS_LABELS } from "@/lib/planGrants/grantState";
import { lastAccessDateLabel } from "@/lib/planGrants/grantDates";
import { PLAN_LABELS } from "@/lib/plans";
import { formatDate } from "@/lib/controlPanelDateTime";

const STATUS_PILL: Record<string, string> = {
  active:    "bg-green-100 text-green-700",
  scheduled: "bg-blue-50 text-blue-700",
};

function endCell(row: PlanGrantReportRow) {
  if (row.status === "active" || row.status === "scheduled") {
    if (!row.endsAt) return <span className="text-gray-500">No expiry</span>;
    return (
      <span className={row.endingSoon ? "text-amber-700 font-medium" : "text-gray-700"}>
        Through {lastAccessDateLabel(row.endsAt)}
        {row.daysRemaining !== null && <span className="text-xs text-gray-500"> · {row.daysRemaining}d left</span>}
      </span>
    );
  }
  return <span className="text-gray-500">{row.endsAt ? `Ended ${formatDate(row.endsAt)}` : "Ended"}</span>;
}

export default async function PlanGrantsReportPage() {
  const result = await getPlanGrantReport();
  const rows = result ?? [];
  const summary = summarizePlanGrantReport(rows);

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center" className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Comp &amp; Trial access</h1>
        <p className="mt-1 text-sm text-gray-500">
          Venues with founder-granted Pro or Premium access — no card, no Stripe subscription, never counted as
          revenue. Active and scheduled grants first (soonest end first), then grants that ended in the last{" "}
          {GRANT_RECENTLY_ENDED_DAYS} days. &ldquo;Ending soon&rdquo; means within {GRANT_ENDING_SOON_DAYS} days.
          Manage a grant from the venue&rsquo;s page.
        </p>
      </div>

      {result === null ? (
        <div className="bg-red-50 rounded-xl border border-red-200 p-6 text-sm text-red-700">
          Comp &amp; Trial grant data couldn&rsquo;t be loaded. Refresh to try again.
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-sm font-medium text-slate-700 mb-1">No Comp or Trial grants</p>
          <p className="text-xs text-gray-400">Grant access from a claimed venue&rsquo;s Control Panel page.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
            <strong>{summary.active}</strong> active · <strong>{summary.scheduled}</strong> scheduled ·{" "}
            <strong>{summary.endingSoon}</strong> ending soon
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-resting overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Venue</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Grant</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Effective plan</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Billing</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Started</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Expiry</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.grantId} className={row.endingSoon ? "bg-amber-50/40" : undefined}>
                    <td className="px-4 py-2.5">
                      <Link href={`/control-panel/venues/${row.venueId}`} className="font-medium text-amber-700 hover:underline">
                        {row.venueName}
                      </Link>
                      {row.city && <div className="text-xs text-gray-400">{row.city}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800">{row.label}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_PILL[row.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {GRANT_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-800">{PLAN_LABELS[row.effectivePlan]}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {row.nonPaying ? "Non-paying" : `${PLAN_LABELS[row.billingPlan]} paid`}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{formatDate(row.startsAt)}</td>
                    <td className="px-4 py-2.5">{endCell(row)}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate" title={row.reason}>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
