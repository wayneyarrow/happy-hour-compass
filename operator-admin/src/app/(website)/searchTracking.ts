"use client";

import { getSessionId } from "@/lib/trackingSession";

/**
 * Phase 4B — first-party tracking of consumer free-text searches on the
 * public website. Extends the same fire-and-forget-POST convention as
 * discoveryTracking.tsx (venue_discover_events) to a new table,
 * website_search_events (migration 089) via /api/track/website-search.
 *
 * Purely additive: does not touch GA4 (trackGA4Event), Vercel `search_used`,
 * or search-tag/venue-discover tracking — all of that keeps firing exactly
 * as before alongside this.
 */

export type WebsiteSearchSurface = "homepage_hero" | "listing_page";

/**
 * Fire-and-forget "meaningful search" event. Callers are responsible for
 * their own debounce + dedupe (see HeroVenueSearch.tsx and
 * HappyHoursSearchClient.tsx) — this function itself fires unconditionally
 * whenever called, exactly once per call.
 */
export function fireWebsiteSearch(params: {
  searchTerm: string;
  surface: WebsiteSearchSurface;
  resultCount: number;
  /** Market slug (Market.id) active when the search was performed, where reliably available. */
  marketId?: string;
}): void {
  fetch("/api/track/website-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchTerm: params.searchTerm,
      surface: params.surface,
      resultCount: params.resultCount,
      sessionId: getSessionId(),
      marketId: params.marketId,
    }),
  }).catch(() => {});
}
