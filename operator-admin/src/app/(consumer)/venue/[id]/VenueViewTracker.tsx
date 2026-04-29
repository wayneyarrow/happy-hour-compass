"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

type Props = {
  venueId: string;
  city: string;
};

/** Fires venue_viewed once when the venue detail page mounts. Renders nothing. */
export function VenueViewTracker({ venueId, city }: Props) {
  useEffect(() => {
    trackEvent("venue_viewed", { venue_id: venueId, city });
  }, [venueId, city]);

  return null;
}
