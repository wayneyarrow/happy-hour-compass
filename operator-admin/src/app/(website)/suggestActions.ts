"use server";

import { getMarketById } from "@/lib/markets";
import { searchVenueSuggestions, type VenueSuggestion } from "@/lib/data/venueSuggestions";

/**
 * Server action behind the Hero's search pill (Homepage venue search). The
 * client (HeroSection) already knows which market it's rendered for — it's
 * passed in as a prop from the page — but this re-resolves marketId against
 * the known MARKETS config server-side rather than trusting a client-passed
 * lat/lng/radius directly, the same defensive pattern setMarketAction uses
 * for the market cookie.
 *
 * Returns [] for an unknown marketId or a blank query instead of throwing —
 * a suggestion dropdown should degrade to "no results" quietly, never surface
 * an error state to the visitor.
 */
export async function suggestHomepageVenuesAction(
  marketId: string,
  query: string
): Promise<VenueSuggestion[]> {
  const market = getMarketById(marketId);
  if (!market) return [];
  return searchVenueSuggestions(market, query);
}
