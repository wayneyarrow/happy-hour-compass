export const dynamic = "force-dynamic";
export const metadata = { title: "Inactive Operators — Action Center" };

import Link from "next/link";
import { getInactiveOperators } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";
import { resolvePageMarketScope } from "@/lib/data/controlPanelMarketOptions";
import ActionCenterMarketFilter from "../../ActionCenterMarketFilter";

export default async function InactiveOperatorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Authorize before any data read or render — see requireControlPanelAdmin.ts.
  await requireControlPanelAdmin();

  // Market filter (?market=): rows are scoped on the server, so search,
  // paging, counts and CSV export all cover exactly this market.
  const market = await resolvePageMarketScope(await searchParams);

  const rows = await getInactiveOperators(market.scope);
  const operatorCount = new Set(rows.map((r) => r.operatorId).filter(Boolean)).size;

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href={`/control-panel/action-center${market.query}`}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Inactive Operators</h1>
        <div className="mt-3"><ActionCenterMarketFilter market={market} /></div>
        <p className="mt-1 text-sm text-gray-500">
          Operators who haven&apos;t logged in for 30+ days. Venues at risk of abandonment.
          Sorted by longest inactive period first.
        </p>
      </div>

      <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-800">
        <strong>{rows.length}</strong> {rows.length === 1 ? "venue" : "venues"} owned by{" "}
        <strong>{operatorCount}</strong> inactive {operatorCount === 1 ? "operator" : "operators"} (30+ days since last login).
        The Action Center card counts operators; an operator with several venues has one row per venue.
      </div>

      <ReportTable rows={rows} />
    </div>
  );
}
