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

export async function getControlPanelMarketOptions(): Promise<MarketFilterOption[]> {
  return buildMarketFilterOptions(await getAllMarkets());
}
