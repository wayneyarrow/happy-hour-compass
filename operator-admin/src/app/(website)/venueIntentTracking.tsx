"use client";

import type { AnchorHTMLAttributes } from "react";
import { getSessionId } from "@/lib/trackingSession";

/**
 * Operator Admin "Intent" tracking for the public website's venue Website
 * and Menu links — posts to /api/track/venue-click (venue_click_events),
 * the same endpoint the consumer app's VenueInfoRows uses.
 *
 * keepalive so the request survives the navigation the link triggers; the
 * link's own default behaviour is never prevented or delayed, and a failed
 * or rejected request is ignored (the endpoint logs server-side).
 */
export type VenueIntentLinkType = "website" | "menu";

export function trackVenueIntentClick(venueId: string, clickType: VenueIntentLinkType): void {
  if (!venueId) return;
  try {
    fetch("/api/track/venue-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ venueId, clickType, sessionId: getSessionId() }),
    }).catch(() => {});
  } catch {
    // Tracking must never block navigation.
  }
}

type TrackedVenueLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** Venue database UUID (ConsumerVenue.venueUuid / event.venueId). */
  venueId: string;
  /** Intent recorded on activation; omit for a link that should not be counted (e.g. Directions). */
  clickType?: VenueIntentLinkType;
};

/**
 * Drop-in <a> for Server Components: renders exactly the anchor it is given
 * and records one Intent event per activation.
 */
export function TrackedVenueLink({ venueId, clickType, onClick, ...anchorProps }: TrackedVenueLinkProps) {
  return (
    <a
      {...anchorProps}
      onClick={(e) => {
        if (clickType) trackVenueIntentClick(venueId, clickType);
        onClick?.(e);
      }}
    />
  );
}
