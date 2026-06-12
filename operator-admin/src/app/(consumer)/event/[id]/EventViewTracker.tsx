"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";

type Props = {
  eventId: string;
};

function getSessionId(): string {
  try {
    const key = "hhc_session_id";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

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
