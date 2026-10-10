"use client";

import { getSessionId } from "@/lib/trackingSession";
import type { CapturedSearch } from "@/lib/discoveryTracking/searchCapture";

/**
 * First-party tracking of consumer free-text searches on the public website
 * (website_search_events — migrations 089 + 110, via /api/track/website-search).
 *
 * Callers never call this directly: useSearchCapture()
 * (tracking/useSearchCapture.ts) decides WHEN a search is meaningful (1s
 * pause, Enter, selection — see src/lib/discoveryTracking/searchCapture.ts)
 * and passes the captured search here exactly once.
 *
 * Purely additive: does not touch GA4 (trackGA4Event), Vercel `search_used`,
 * or search-tag tracking.
 */

export type WebsiteSearchSurface = "homepage_hero" | "listing_page";

export function fireWebsiteSearch(params: {
  search: CapturedSearch;
  surface: WebsiteSearchSurface;
  /** Market slug (Market.id) active when the search was performed. */
  marketId?: string;
}): void {
  const { search } = params;
  try {
    fetch("/api/track/website-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A selection navigates immediately — keepalive lets the row survive it.
      keepalive: true,
      body: JSON.stringify({
        searchId: search.searchId,
        searchTerm: search.searchTerm,
        surface: params.surface,
        mode: search.mode,
        origin: search.origin,
        captureTrigger: search.trigger,
        resultCount: search.resultCount,
        resultCountCapped: search.resultCountCapped,
        otherFiltersActive: search.otherFiltersActive,
        sessionId: getSessionId(),
        marketId: params.marketId,
      }),
    }).catch(() => {});
  } catch {
    // Tracking must never throw.
  }
}
