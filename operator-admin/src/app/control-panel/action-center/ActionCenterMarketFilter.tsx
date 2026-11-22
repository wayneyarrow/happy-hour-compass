import UrlMarketFilter from "@/components/UrlMarketFilter";
import type { PageMarketScope } from "@/lib/data/controlPanelMarketOptions";

/**
 * Market filter for the Action Center summary and its reports. Server-side
 * filtering from the page-specific ?market= (resolvePageMarketScope);
 * changing it keeps every other URL param (search, sort, view) and resets
 * paging. Unknown values fall back to All markets and are cleared.
 */
export default function ActionCenterMarketFilter({ market }: { market: PageMarketScope }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <UrlMarketFilter
        options={market.options}
        value={market.selection}
        rejected={market.rejected}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
      {market.scope.kind !== "all" && (
        <span className="text-xs text-gray-400">
          Showing {market.label} — by each venue&rsquo;s current market
        </span>
      )}
    </div>
  );
}
