"use client";

import { useEffect, useRef } from "react";
import { getSessionId } from "@/lib/trackingSession";

/**
 * Phase 4A — website-side venue discovery attribution.
 *
 * Extends the existing venue_discover_events / /api/track/venue-discover
 * infrastructure (migration 043, already proven on the consumer app's
 * homepage — see (consumer)/home/ConsumerHome.tsx and
 * (consumer)/home/VenueRailCard.tsx) to the public website's curated venue
 * placements: homepage rails, homepage featured sections, and guides.
 *
 * Deliberately NOT a new table or endpoint — the existing schema
 * (venue_id, event_type, rail_name, position, session_id) already fits
 * this need exactly; only the callers are new.
 *
 * ── Naming convention for rail_name on the website side ────────────────
 * The consumer app's existing rail_name values are bare identifiers
 * (spotlight, patio_picks, highly_rated, featured_nearby, new_this_week —
 * see migration 043's comment and ConsumerHome.tsx). rail_name is
 * unconstrained TEXT (the migration's own comment: "not enforced — TEXT
 * for flexibility"), so the website introduces a colon-prefixed convention
 * on the same column without any conflict or migration:
 *
 *   homepage_rail:<homepage_sections.id>     — a venue_collection Section
 *   homepage_feature:<homepage_sections.id>  — a venue_feature Section
 *   guide:<guide-slug>                       — a venue card inside a Guide
 *
 * The prefix distinguishes website-origin rows from the consumer app's
 * bare rail names at query time; the identifier after the colon is always
 * a stable id (a DB row id or slug), never a human-readable title that an
 * editor could rename later.
 */

export type DiscoveryContext = {
  /** The venue_discover_events.rail_name value — see naming convention above. */
  context: string;
  /** 0-based position of this venue within its curated placement. */
  position: number;
};

/**
 * Fire-and-forget "click" event for a single venue — called from a card's
 * onClick just like (consumer)/home/VenueRailCard.tsx's handleClick().
 * Never blocks or delays navigation: no preventDefault, no await, errors
 * are swallowed exactly like every other /api/track/* caller in this repo.
 */
export function fireDiscoveryClick(venueId: string, discovery: DiscoveryContext): void {
  fetch("/api/track/venue-discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venueId,
      eventType: "click",
      railName: discovery.context,
      position: discovery.position,
      sessionId: getSessionId(),
    }),
  }).catch(() => {});
}

type ImpressionItem = { venueId: string; position: number };

/**
 * Fires one batched "impression" POST for a curated set of venues, once
 * per mount — mirrors ConsumerHome.tsx's rail-level batch impression
 * pattern exactly (ref snapshot taken at first render + an intentionally
 * empty effect-dependency array, so a parent rerender — e.g. unrelated
 * homepage state changing — can never re-fire it; only an actual remount
 * of this component does). Renders nothing.
 *
 * An "impression" here means the venue placement was included in the
 * resolved, rendered set of cards for this curated surface — the same
 * definition ConsumerHome.tsx already uses (fired on mount of the
 * surface, not gated behind viewport visibility/IntersectionObserver,
 * matching the existing proven behaviour rather than introducing a
 * stricter definition only on the website side).
 */
export function DiscoveryImpressionTracker({
  context,
  items,
}: {
  context: string;
  items: ImpressionItem[];
}) {
  const initialRef = useRef({ context, items });

  useEffect(() => {
    const { context: ctx, items: initialItems } = initialRef.current;
    if (initialItems.length === 0) return;

    fetch("/api/track/venue-discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: initialItems.map(({ venueId, position }) => ({
          venueId,
          eventType: "impression",
          railName: ctx,
          position,
          sessionId: getSessionId(),
        })),
      }),
    }).catch(() => {});
    // Intentionally empty — see doc comment above; initialRef.current is a
    // one-time snapshot, not a reactive dependency (initialRef itself is
    // referentially stable, so exhaustive-deps has nothing to add here).
  }, []);

  return null;
}
