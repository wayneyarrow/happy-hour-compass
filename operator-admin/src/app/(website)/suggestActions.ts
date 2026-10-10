"use server";

import { getMarketById } from "@/lib/markets";
import { searchVenueSuggestionsWithTotal, type VenueSuggestion } from "@/lib/data/venueSuggestions";
import { searchDailySpecialSuggestionsWithTotal, type DailySpecialSuggestion } from "./dailySpecialSuggestions";
import { searchEventSuggestionsWithTotal, type EventSuggestion } from "./eventSuggestions";

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
 * All three return no suggestions for an unknown marketId or a blank query
 * instead of throwing — a suggestion dropdown should degrade to "no results"
 * quietly, never surface an error state to the visitor.
 *
 * Each returns the displayed suggestions (capped at 8) plus `total`, the
 * full number of matches before that cap, which search tracking records
 * (website_search_events.result_count, migration 110).
 */

export type SuggestionResult<T> = { suggestions: T[]; total: number };

const EMPTY = { suggestions: [], total: 0 };
export async function suggestHomepageVenuesAction(
  marketId: string,
  query: string
): Promise<SuggestionResult<VenueSuggestion>> {
  const market = getMarketById(marketId);
  if (!market) return EMPTY;
  return searchVenueSuggestionsWithTotal(market, query);
}

export async function suggestHomepageDailySpecialsAction(
  marketId: string,
  query: string
): Promise<SuggestionResult<DailySpecialSuggestion>> {
  const market = getMarketById(marketId);
  if (!market) return EMPTY;
  return searchDailySpecialSuggestionsWithTotal(market, query);
}

export async function suggestHomepageEventsAction(
  marketId: string,
  query: string
): Promise<SuggestionResult<EventSuggestion>> {
  const market = getMarketById(marketId);
  if (!market) return EMPTY;
  return searchEventSuggestionsWithTotal(market, query);
}
