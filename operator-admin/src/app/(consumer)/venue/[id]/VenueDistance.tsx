"use client";

import { useState, useEffect } from "react";

const EARTH_R_KM = 6371;

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Props = {
  lat: number;
  lng: number;
  /**
   * Text prepended to the distance label when a value is ready.
   * Pass " \u2022 " to join with the preceding status line text.
   */
  separator?: string;
};

/**
 * Requests browser geolocation once on mount and renders the approximate
 * distance to the venue. Renders nothing if geolocation is unavailable,
 * denied, or the request times out.
 */
export function VenueDistance({ lat, lng, separator = "" }: Props) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const km = haversineKm(
          coords.latitude,
          coords.longitude,
          lat,
          lng
        );
        setLabel(`${km.toFixed(1)} km`);
      },
      () => {
        // Permission denied or error — show nothing.
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, [lat, lng]);

  if (!label) return null;
  return (
    <>
      {separator}
      {label}
    </>
  );
}
