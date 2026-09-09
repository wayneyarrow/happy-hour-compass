"use server";

import { getMarketById } from "@/lib/markets";
import { searchVenueSuggestions, type VenueSuggestion } from "@/lib/data/venueSuggestions";
import { searchDailySpecialSuggestions, type DailySpecialSuggestion } from "./dailySpecialSuggestions";
import { searchEventSuggestions, type EventSuggestion } from "./eventSuggestions";

/**
 * Server actions behind the Hero's search pill (Homepage discovery search —
 * one action per discovery mode's entity type: Happy Hours searches
 * venues, Daily Specials searches Daily Special records, Events searches
 * Event records — see HeroDiscoverySearch.tsx, which dispatches to
 * whichever of these matches the currently selected mode). The client
 * (HeroSection) already knows which market it's rendered for — it's passed
 * in as a prop from the page — but each action re-resolves marketId
 * against the known MARKETS config server-side rather than trusting a
 * client-passed lat/lng/radius directly, the same defensive pattern
 * setMarketAction uses for the market cookie.
 *
 * All three return [] for an unknown marketId or a blank query instead of
 * throwing — a suggestion dropdown should degrade to "no results" quietly,
 * never surface an error state to the visitor.
 */
export async function suggestHomepageVenuesAction(
  marketId: string,
  query: string
): Promise<VenueSuggestion[]> {
  const market = getMarketById(marketId);
  if (!market) return [];
  return searchVenueSuggestions(market, query);
}

export async function suggestHomepageDailySpecialsAction(
  marketId: string,
  query: string
): Promise<DailySpecialSuggestion[]> {
  const market = getMarketById(marketId);
  if (!market) return [];
  return searchDailySpecialSuggestions(market, query);
}

export async function suggestHomepageEventsAction(
  marketId: string,
  query: string
): Promise<EventSuggestion[]> {
  const market = getMarketById(marketId);
  if (!market) return [];
  return searchEventSuggestions(market, query);
}
