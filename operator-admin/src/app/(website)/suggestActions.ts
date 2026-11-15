"use server";

import { resolveSearchMarket } from "@/lib/discover/marketScope";
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
 * setMarketAction uses for the market cookie. Only an active market
 * searches (resolveSearchMarket) — a coming-soon id returns nothing.
 *
 * Market scope: every action searches ONLY records assigned to that market
 * (venues.market_id; Daily Specials and Events through their venue) —
 * applied before ranking and the 8-suggestion cap, never mixing in other
 * markets' matches.
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
  const market = resolveSearchMarket(marketId);
  if (!market) return EMPTY;
  return searchVenueSuggestionsWithTotal(market, query);
}

export async function suggestHomepageDailySpecialsAction(
  marketId: string,
  query: string
): Promise<SuggestionResult<DailySpecialSuggestion>> {
  const market = resolveSearchMarket(marketId);
  if (!market) return EMPTY;
  return searchDailySpecialSuggestionsWithTotal(market, query);
}

export async function suggestHomepageEventsAction(
  marketId: string,
  query: string
): Promise<SuggestionResult<EventSuggestion>> {
  const market = resolveSearchMarket(marketId);
  if (!market) return EMPTY;
  return searchEventSuggestionsWithTotal(market, query);
}
