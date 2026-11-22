export const dynamic = "force-dynamic";
export const metadata = { title: "Unpublished Venues — Action Center" };

import Link from "next/link";
import { getUnpublishedVenues } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";
import { resolvePageMarketScope } from "@/lib/data/controlPanelMarketOptions";
import ActionCenterMarketFilter from "../../ActionCenterMarketFilter";

export default async function UnpublishedVenuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Authorize before any data read or render — see requireControlPanelAdmin.ts.
  await requireControlPanelAdmin();

  // Market filter (?market=): rows are scoped on the server, so search,
  // paging, counts and CSV export all cover exactly this market.
  const market = await resolvePageMarketScope(await searchParams);

  const rows = await getUnpublishedVenues(market.scope);

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href={`/control-panel/action-center${market.query}`}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Unpublished Venues</h1>
        <div className="mt-3"><ActionCenterMarketFilter market={market} /></div>
        <p className="mt-1 text-sm text-gray-500">
          Venues not visible to consumers. Sorted by highest health score — venues closest to
          completion should be unblocked first.
        </p>
      </div>

      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
        <strong>{rows.length}</strong> unpublished {rows.length === 1 ? "venue" : "venues"} across the platform.
      </div>

      <ReportTable rows={rows} />
    </div>
  );
}
