export const dynamic = "force-dynamic";
export const metadata = { title: "Upgrade Opportunities — Action Center" };

import Link from "next/link";
import { getUpgradeOpportunities } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";

export default async function UpgradeOpportunitiesPage() {
  const rows = await getUpgradeOpportunities();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Upgrade Opportunities</h1>
        <p className="mt-1 text-sm text-gray-500">
          Published Free or Pro venues with a health score ≥ 90% that have hit at least one
          plan limit — or aren&apos;t using Events yet and are on a plan that only offers one-time
          (no recurring/advanced) events. These operators are ready to upgrade — they&apos;ve either
          outgrown their current plan, or could unlock a feature they haven&apos;t tried. Filter by
          opportunity type or venue verification status to target outreach.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-sm font-medium text-slate-700 mb-1">No upgrade opportunities found</p>
          <p className="text-xs text-gray-400">
            Venues appear here when they are published, have a health score ≥ 90%, are on Free or Pro,
            and have reached at least one plan limit (images, food specials, drink specials, team members),
            or have no events yet and are on a plan limited to one-time-only events.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-800">
            <strong>{rows.length}</strong> {rows.length === 1 ? "venue has" : "venues have"} hit a plan limit and are ready to upgrade.
          </div>
          <ReportTable rows={rows} />
        </>
      )}
    </div>
  );
}
