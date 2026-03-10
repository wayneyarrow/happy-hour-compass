"use client";

import { useState, useEffect } from "react";
import { getOpenStatus, haversineKm } from "../../VenueList";

type Props = {
  hoursWeekly: Record<string, string>;
  lat: number | null;
  lng: number | null;
  establishmentType: string;
};

/**
 * Renders the venue detail meta row — status badge, distance, category.
 * Matches the original .venue-meta-row from index.html:
 *   .status-badge.status-open (green, only shown when Open Now)
 *   .distance-prominent (blue, geolocation-based)
 *   .category-tag (gray, establishment type)
 *
 * Reuses getOpenStatus + haversineKm already exported from VenueList.tsx.
 */
export function VenueDetailMeta({ hoursWeekly, lat, lng, establishmentType }: Props) {
  const [openStatus, setOpenStatus] = useState<string | null>(null);
  const [dist, setDist] = useState<string | null>(null);

  useEffect(() => {
    setOpenStatus(getOpenStatus(hoursWeekly));
  }, [hoursWeekly]);

  useEffect(() => {
    if (!navigator.geolocation || lat === null || lng === null) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const km = haversineKm(coords.latitude, coords.longitude, lat, lng);
        setDist(`${km.toFixed(1)} km`);
      },
      () => {
        // Permission denied or error — show nothing.
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, [lat, lng]);

  const hasAny = openStatus === "Open Now" || dist !== null || establishmentType;
  if (!hasAny) return null;

  return (
    <div className="flex items-center gap-[4px] flex-wrap text-[12px] mt-2">
      {/* .status-badge.status-open — green, only shown when Open Now */}
      {openStatus === "Open Now" && (
        <span className="inline-block px-[6px] py-[2px] rounded bg-[#dcfce7] text-[#166534] text-[11px] font-medium flex-shrink-0">
          Open Now
        </span>
      )}
      {/* .distance-prominent — blue */}
      {dist !== null && (
        <span className="text-[#3b82f6] text-[12px] font-medium flex-shrink-0 whitespace-nowrap">
          {dist}
        </span>
      )}
      {/* .category-tag — gray */}
      {establishmentType && (
        <span className="text-[#6b7280] text-[11px] overflow-hidden text-ellipsis whitespace-nowrap">
          &bull; {establishmentType}
        </span>
      )}
    </div>
  );
}
