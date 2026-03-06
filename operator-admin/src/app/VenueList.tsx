"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ConsumerVenue } from "@/lib/data/venues";

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
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Props = {
  venues: ConsumerVenue[];
};

/**
 * Renders the venue discovery list.
 * On mount, requests browser geolocation and re-sorts venues nearest-first.
 * Falls back to the original server-provided order if geolocation is
 * unavailable, denied, or any venue lacks coordinates.
 */
export function VenueList({ venues }: Props) {
  const [sorted, setSorted] = useState(venues);

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: uLat, longitude: uLng } = coords;

        const withDist = venues.map((v) => ({
          venue: v,
          dist:
            v.latitude !== null && v.longitude !== null
              ? haversineKm(uLat, uLng, v.latitude, v.longitude)
              : null,
        }));

        withDist.sort((a, b) => {
          if (a.dist === null && b.dist === null) return 0;
          if (a.dist === null) return 1;
          if (b.dist === null) return -1;
          return a.dist - b.dist;
        });

        setSorted(withDist.map((x) => x.venue));
      },
      () => {
        // Permission denied or error — keep original order.
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, [venues]);

  return (
    <ul className="space-y-4">
      {sorted.map((venue) => (
        <li key={venue.id}>
          <Link href={`/venue/${venue.id}`}>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition">
              <h2 className="font-semibold text-gray-900">{venue.name}</h2>
              {venue.city && (
                <p className="text-xs text-gray-500 mt-0.5">{venue.city}</p>
              )}
              {venue.happyHourTagline && (
                <p className="text-sm text-amber-700 mt-1">
                  {venue.happyHourTagline}
                </p>
              )}
              {venue.events.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-gray-700">
                  {venue.events.map((event) => (
                    <li key={event.id}>
                      <span className="font-medium">{event.title}</span>
                      {event.nextOccurrenceLabel && (
                        <span className="ml-1 text-gray-500">
                          · {event.nextOccurrenceLabel}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
