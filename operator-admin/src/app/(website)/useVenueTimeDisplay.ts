"use client";

import { useEffect, useState } from "react";
import { getVisitorTimeZone } from "@/lib/timeZones";
import { resolveTimeDisplay, type TimeDisplay } from "@/lib/venueTimeDisplay";

/**
 * Which clock a venue's hours should read in for this visitor (see
 * src/lib/venueTimeDisplay.ts). Null until mounted: the server has no
 * visitor timezone, and every hours/status surface on the website already
 * renders its time-sensitive text only after mount, so there is no
 * hydration mismatch.
 */
export function useVenueTimeDisplay(venueTimeZone: string): TimeDisplay | null {
  const [display, setDisplay] = useState<TimeDisplay | null>(null);
  useEffect(() => {
    setDisplay(resolveTimeDisplay(venueTimeZone, getVisitorTimeZone()));
  }, [venueTimeZone]);
  return display;
}
