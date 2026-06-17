"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";
import { getSessionId } from "@/lib/trackingSession";

type Props = {
  eventId: string;
};

/** Fires event_viewed once when the event detail page mounts. Renders nothing. */
export function EventViewTracker({ eventId }: Props) {
  const hasTracked = useRef(false);

  useEffect(() => {
    if (hasTracked.current) return;
    hasTracked.current = true;

    trackEvent("event_viewed", { event_id: eventId });

    // Persist to Supabase — non-blocking, errors silently swallowed.
    const sessionId = getSessionId();
    fetch("/api/track/event-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, sessionId }),
    }).catch(() => {});
  }, [eventId]);

  return null;
}
