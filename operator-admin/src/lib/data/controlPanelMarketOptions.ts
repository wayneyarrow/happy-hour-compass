/**
 * Server-side loader for the Control Panel Market filter options.
 *
 * Reads the DB `markets` table through the existing geography helper
 * (getAllMarkets(), admin client) and shapes it with the pure
 * buildMarketFilterOptions() in src/lib/marketFilter.ts. Throws on a failed
 * read, like getAllMarkets() — callers show an error rather than a filter
 * with silently missing markets.
 *
 * Authorization is the caller's job: every Control Panel page calls
 * requireControlPanelAdmin() before any data read.
 */

import { getAllMarkets } from "@/lib/geo/geography";
import { buildMarketFilterOptions, type MarketFilterOption } from "@/lib/marketFilter";
import {
  MARKET_FILTER_ALL,
  MARKET_FILTER_UNASSIGNED,
  marketFilterOptionLabel,
  marketFilterParamValue,
  parseMarketFilter,
  type MarketFilterSelection,
} from "@/lib/marketFilter";
import { scopeFromSelection, type DashboardMarketScope } from "@/lib/dashboardMarketScope";

export async function getControlPanelMarketOptions(): Promise<MarketFilterOption[]> {
  return buildMarketFilterOptions(await getAllMarkets());
}


export type PageMarketScope = {
  options: MarketFilterOption[];
  selection: MarketFilterSelection;
  /** An unknown ?market= value was supplied (falls back to All; UrlMarketFilter clears it). */
  rejected: boolean;
  scope: DashboardMarketScope;
  /** "All markets", the market's name (coming-soon labelled), or "Unassigned". */
  label: string;
  /** "?market=<value>" (or "" for All) — append to links that should keep the selection. */
  query: string;
};

/**
 * Resolves a server page's ?market= param — the shared convention for
 * server-filtered Control Panel pages (Analytics, Action Center).
 */
export async function resolvePageMarketScope(
  params: Record<string, string | string[] | undefined>
): Promise<PageMarketScope> {
  const options = await getControlPanelMarketOptions();
  const raw = typeof params.market === "string" ? params.market : null;
  const selection = parseMarketFilter(raw, options);
  const option = options.find((o) => o.slug === selection) ?? null;
  const value = marketFilterParamValue(selection);
  return {
    options,
    selection,
    rejected: !!raw && selection === MARKET_FILTER_ALL,
    scope: scopeFromSelection(selection, options),
    label: selection === MARKET_FILTER_UNASSIGNED ? "Unassigned" : option ? marketFilterOptionLabel(option) : "All markets",
    query: value ? `?market=${encodeURIComponent(value)}` : "",
  };
}
