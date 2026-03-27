"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ConsumerVenue } from "@/lib/data/venues";
import { BookmarkButton } from "./BookmarkButton";

export function haversineKm(
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

/** Returns true if a happy hour slot is currently active (matches original calculateHappyHourStatus). */
export function isHappeningNow(
  happyHourWeekly: Record<string, Array<{ start: string; end: string }>>
): boolean {
  const now = new Date();
  const dayName = DAYS[now.getDay()];
  const slots = happyHourWeekly[dayName];
  if (!slots || slots.length === 0) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return slots.some((slot) => {
    const [sh, sm] = slot.start.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = slot.end === "close" ? 1440 : (() => { const [eh, em] = slot.end.split(":").map(Number); return eh * 60 + em; })();
    return nowMin >= startMin && nowMin < endMin;
  });
}

/** Returns "Open Now", "Closed", or null (hours unavailable / unparseable). */
export function getOpenStatus(
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

// ─── image helpers ────────────────────────────────────────────────────────────

/**
 * Maps establishment type to a placeholder image path.
 * Mirrors original getVenueImage() logic from index.html.
 */
function getVenueImageSrc(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery")) return "/images/casual-dining-1.jpg";
  if (t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

// ─── specials helper ──────────────────────────────────────────────────────────

/**
 * Returns short specials text for a listing card.
 * Mirrors original getVenueShortSpecials() logic from index.html.
 */
function getShortSpecials(venue: ConsumerVenue): string {
  if (venue.happyHourTagline) return venue.happyHourTagline;
  const food = venue.specialsFood[0] ?? "";
  const drinks = venue.specialsDrinks[0] ?? "";
  if (food && drinks) return `${food}, ${drinks}`;
  return food || drinks || "Happy Hour Specials";
}

// ─────────────────────────────────────────────────────────────────────────────

type VenueWithDist = {
  venue: ConsumerVenue;
  dist: number | null;
  openStatus: string | null;
};

type Props = {
  venues: ConsumerVenue[];
};

/**
 * Renders the venue discovery list.
 * Card layout mirrors original index.html .listing-item structure:
 * 72×72 image | name + bookmark / offer text / meta (badge · distance · category)
 */
export function VenueList({ venues }: Props) {
  const [sorted, setSorted] = useState<VenueWithDist[]>(
    () =>
      venues.map((v) => ({
        venue: v,
        dist: null,
        openStatus: null,
      }))
  );

  // Compute client-side derived values after hydration.
  useEffect(() => {
    setSorted((prev) =>
      prev.map((item) => ({
        ...item,
        openStatus: getOpenStatus(item.venue.hoursWeekly),
      }))
    );
  }, []);

  // Sync sorted when the venues prop changes (e.g. search filtering narrows the list).
  useEffect(() => {
    setSorted((prev) => {
      const venueIds = new Set(venues.map((v) => v.id));
      const kept = prev.filter((item) => venueIds.has(item.venue.id));
      const keptIds = new Set(kept.map((item) => item.venue.id));
      const added = venues
        .filter((v) => !keptIds.has(v.id))
        .map((v) => ({
          venue: v,
          dist: null,
          openStatus: getOpenStatus(v.hoursWeekly),
        }));
      return [...kept, ...added];
    });
  }, [venues]);

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
    <ul>
      {sorted.map(({ venue, dist, openStatus }) => {
        const imageSrc = venue.images[0]?.url ?? getVenueImageSrc(venue.establishmentType);
        const shortSpecials = getShortSpecials(venue);

        return (
          <li key={venue.id}>
            {/* Card mirrors original .listing-item: white, 8px radius, 14px padding, border-bottom divider */}
            <Link
              href={`/venue/${venue.id}`}
              className="block"
              onClick={() => {
                const el = document.getElementById("consumer-scroll");
                if (el) sessionStorage.setItem("hhc_list_scroll", String(el.scrollTop));
              }}
            >
              <div className="bg-white rounded-[8px] p-[14px] mb-px border-b border-[#f3f4f6] flex gap-3 cursor-pointer hover:bg-[#fafbfc] transition-colors">

                {/* Venue image — mirrors original .listing-image: 72×72, 8px radius */}
                <div className="w-[72px] h-[72px] rounded-[8px] flex-shrink-0 overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageSrc}
                    alt={venue.name}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Content — mirrors original .listing-content: flex column, gap 4px */}
                <div className="flex-1 flex flex-col gap-[4px] min-w-0">

                  {/* Header row: name + bookmark — mirrors .listing-header */}
                  <div className="flex justify-between items-center mb-[2px]">
                    <div
                      className="font-bold text-[17px] text-[#111827] leading-[1.2] flex-1 min-w-0 break-words"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {venue.name}
                    </div>
                    <BookmarkButton venueId={venue.id} />
                  </div>

                  {/* Offer text — mirrors .listing-offer: bold, dark #111827, line-clamp 2 */}
                  <div
                    className="text-[#111827] font-bold text-[14px] leading-[1.3]"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {shortSpecials}
                  </div>

                  {/* Meta row — mirrors .listing-meta: status badge · distance · category */}
                  <div className="flex items-center gap-[3px] text-[12px] text-[#9ca3af] flex-nowrap min-w-0">
                    {openStatus === "Open Now" && (
                      <span className="inline-block px-[6px] py-[2px] rounded bg-[#dcfce7] text-[#166534] text-[11px] font-medium flex-shrink-0">
                        Open Now
                      </span>
                    )}
                    {dist !== null && (
                      <span className="text-[#3b82f6] text-[12px] font-medium flex-shrink-0 whitespace-nowrap">
                        {dist.toFixed(1)} km
                      </span>
                    )}
                    {venue.establishmentType && (
                      <span className="text-[#6b7280] text-[11px] overflow-hidden text-ellipsis whitespace-nowrap min-w-0 shrink">
                        &bull; {venue.establishmentType}
                      </span>
                    )}
                  </div>

                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
