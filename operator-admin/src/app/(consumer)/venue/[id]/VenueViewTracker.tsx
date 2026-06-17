"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";
import { getSessionId } from "@/lib/trackingSession";

type Props = {
  venueId: string;
  city: string;
};

/** Fires venue_viewed once when the venue detail page mounts. Renders nothing. */
export function VenueViewTracker({ venueId, city }: Props) {
  const hasTracked = useRef(false);

  useEffect(() => {
    if (hasTracked.current) return;
    hasTracked.current = true;

    trackEvent("venue_viewed", { venue_id: venueId, city });

    // Persist to Supabase — non-blocking, errors silently swallowed.
    const sessionId = getSessionId();
    fetch("/api/track/venue-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId, sessionId, city }),
    }).catch(() => {});
  }, [venueId, city]);

  return null;
}
