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

// ─── open/closed helpers ─────────────────────────────────────────────────────

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Parses "H:MM AM" / "H:MM PM" to minutes since midnight. Returns null if unparseable. */
function parseAmPm(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/** Returns "Open Now", "Closed", or null (hours unavailable / unparseable). */
function getOpenStatus(
  hoursWeekly: Record<string, string>
): "Open Now" | "Closed" | null {
  const now = new Date();
  const dayName = DAYS[now.getDay()];
  const entry = hoursWeekly[dayName];
  if (!entry || entry === "CLOSED") return "Closed";
  const parts = entry.split(" - ");
  if (parts.length !== 2) return null;
  const open = parseAmPm(parts[0]);
  const close = parseAmPm(parts[1]);
  if (open === null || close === null || close <= open) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= open && nowMin < close ? "Open Now" : "Closed";
}

// ─── happy hour helpers ───────────────────────────────────────────────────────

/** Converts a 24h "HH:MM" string to a short display like "4 PM" or "4:30 PM". */
function fmt12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${mStr} ${ampm}`;
}

/**
 * Returns the formatted earliest happy hour start time for today,
 * or null if the venue has no happy hour today.
 */
function getHhStartToday(
  happyHourWeekly: Record<string, Array<{ start: string; end: string }>>
): string | null {
  const dayName = DAYS[new Date().getDay()];
  const slots = happyHourWeekly[dayName];
  if (!slots || slots.length === 0) return null;
  const earliest = slots.slice().sort((a, b) => a.start.localeCompare(b.start))[0];
  return fmt12h(earliest.start);
}

// ─────────────────────────────────────────────────────────────────────────────

type VenueWithDist = {
  venue: ConsumerVenue;
  dist: number | null;
  openStatus: string | null;
  hhStartToday: string | null;
};

type Props = {
  venues: ConsumerVenue[];
};

/**
 * Renders the venue discovery list.
 * On mount, computes open/closed status and today's earliest HH start time
 * from business/happy-hour data, and requests browser geolocation to
 * re-sort venues nearest-first. Falls back gracefully when unavailable.
 */
export function VenueList({ venues }: Props) {
  const [sorted, setSorted] = useState<VenueWithDist[]>(
    () =>
      venues.map((v) => ({
        venue: v,
        dist: null,
        openStatus: null,
        hhStartToday: null,
      }))
  );

  // Compute client-side derived values after hydration.
  useEffect(() => {
    setSorted((prev) =>
      prev.map((item) => ({
        ...item,
        openStatus: getOpenStatus(item.venue.hoursWeekly),
        hhStartToday: getHhStartToday(item.venue.happyHourWeekly),
      }))
    );
  }, []);

  // Request geolocation and re-sort nearest-first, preserving derived values.
  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: uLat, longitude: uLng } = coords;

        setSorted((prev) => {
          const withDist = prev.map((item) => ({
            ...item,
            dist:
              item.venue.latitude !== null && item.venue.longitude !== null
                ? haversineKm(uLat, uLng, item.venue.latitude, item.venue.longitude)
                : null,
          }));

          withDist.sort((a, b) => {
            if (a.dist === null && b.dist === null) return 0;
            if (a.dist === null) return 1;
            if (b.dist === null) return -1;
            return a.dist - b.dist;
          });

          return withDist;
        });
      },
      () => {
        // Permission denied or error — keep original order.
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, [venues]);

  return (
    <ul className="space-y-4">
      {sorted.map(({ venue, dist, openStatus, hhStartToday }) => (
        <li key={venue.id}>
          <Link href={`/venue/${venue.id}`}>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition">
              <h2 className="font-semibold text-gray-900">{venue.name}</h2>
              {venue.city && (
                <p className="text-xs text-gray-500 mt-0.5">{venue.city}</p>
              )}
              {(openStatus !== null || dist !== null || venue.establishmentType) && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {[
                    openStatus,
                    dist !== null ? `${dist.toFixed(1)} km` : null,
                    venue.establishmentType || null,
                  ]
                    .filter(Boolean)
                    .join(" \u2022 ")}
                </p>
              )}
              {venue.happyHourTagline && (
                <p className="text-sm text-amber-700 mt-1">
                  {venue.happyHourTagline}
                </p>
              )}
              {hhStartToday && (
                <p className="text-sm text-orange-600 mt-1">
                  Happy hour starts at {hhStartToday}
                </p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
