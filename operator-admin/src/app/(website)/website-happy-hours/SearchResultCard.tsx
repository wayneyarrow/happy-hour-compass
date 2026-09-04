"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SaveVenueButton } from "@/app/(website)/SaveVenueButton";
import { computeHhStatusForDay, getCurrentDayName, type HhStatus } from "@/lib/happyHourStatus";
import { fireDiscoveryClick, type DiscoveryContext } from "@/app/(website)/discoveryTracking";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { HhStatus };

type HHSlot = { start: string; end: string };

export type SearchResultCardData = {
  /** Venue slug — used for the card key and href routing. */
  id: string;
  /** Venue UUID — used as the durable saved identifier in localStorage. */
  venueUuid: string;
  /** Destination URL for the Venue Detail page, e.g. /[market]/[city]/[slug]. */
  href: string;
  name: string;
  image: string;
  isVerified: boolean;
  googleRating: number | null;
  /**
   * Raw weekly schedule — the HH status is computed client-side (see
   * HhStatusDisplay below) rather than passed pre-computed, so it always
   * reflects the viewer's actual wall-clock time instead of the
   * server/deployment timezone. Mirrors the Venue Detail page's
   * calculateHappyHourStatus() pattern (HappyHourTimesCard.tsx /
   * VenueActionCard.tsx / VenueIdentityStatus.tsx).
   */
  happyHourWeekly: Record<string, HHSlot[]>;
  /** Distance from user in km. Null until client-side geolocation is available. */
  distanceKm: number | null;
  establishmentType: string;
  /** First food special, if any. */
  foodSpecial?: string;
  /** First drink special, if any. */
  drinkSpecial?: string;
};

// ─── Star Rating ─────────────────────────────────────────────────────────────

type StarFill = "full" | "half" | "empty";

function computeStarFills(rating: number): StarFill[] {
  return Array.from({ length: 5 }, (_, i): StarFill => {
    const diff = rating - i;
    if (diff >= 0.75) return "full";
    if (diff >= 0.25) return "half";
    return "empty";
  });
}

const STAR_PATH =
  "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z";

function StarIcon({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={color}
      className="w-[14px] h-[14px] flex-shrink-0"
      aria-hidden="true"
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

function Star({ fill }: { fill: StarFill }) {
  if (fill === "full") return <StarIcon color="#fbbf24" />;
  if (fill === "empty") return <StarIcon color="#e5e7eb" />;
  return (
    <div className="relative w-[14px] h-[14px] flex-shrink-0" aria-hidden="true">
      <StarIcon color="#e5e7eb" />
      <div className="absolute inset-0 overflow-hidden" style={{ width: "50%" }}>
        <StarIcon color="#fbbf24" />
      </div>
    </div>
  );
}

function StarRating({ rating }: { rating: number }) {
  const fills = computeStarFills(rating);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-[2px]" aria-hidden="true">
        {fills.map((fill, i) => (
          <Star key={i} fill={fill} />
        ))}
      </div>
      <span
        className="text-[15px] font-semibold text-gray-900 tabular-nums"
        aria-label={`${rating.toFixed(1)} out of 5 stars on Google`}
      >
        {rating.toFixed(1)}
      </span>
      <span className="text-[11px] text-gray-400 font-normal">· Google</span>
    </div>
  );
}

// ─── Happy Hour Status ────────────────────────────────────────────────────────

/**
 * Computes status client-side on mount (rather than accepting a pre-computed
 * prop) so the result always uses the viewer's actual wall-clock time — a
 * server-computed value would reflect the deployment server's timezone
 * instead. Renders nothing until mounted, matching VenueIdentityStatus.tsx's
 * pattern on the Venue Detail page.
 *
 * `effectiveDayName` is the schedule day this card should evaluate against —
 * passed down by callers with a Day filter (HappyHoursSearchClient) so an
 * upcoming card shows the *selected* day's schedule rather than always
 * today's; null when that Day filter is set to "All Days" (no specific day
 * selected), and defaults to the actual current day (same as undefined) for
 * both that case and callers with no Day filter concept at all (homepage
 * rail, Guide pages), preserving prior behaviour exactly for them.
 */
function HhStatusDisplay({
  happyHourWeekly,
  effectiveDayName,
}: {
  happyHourWeekly: Record<string, HHSlot[]>;
  effectiveDayName?: string | null;
}) {
  const [status, setStatus] = useState<HhStatus | null>(null);

  useEffect(() => {
    setStatus(computeHhStatusForDay(happyHourWeekly, effectiveDayName ?? getCurrentDayName()));
  }, [happyHourWeekly, effectiveDayName]);

  if (!status || status.type === "none") return null;

  if (status.type === "active") {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"
            aria-hidden="true"
          />
          <span className="text-sm font-bold text-green-700">
            Happy Hour On Now
          </span>
        </div>
        <p className="text-sm text-gray-400 pl-4">{status.endsIn}</p>
      </div>
    );
  }

  const prefix =
    status.day === "Today"
      ? "Happy Hour Today"
      : status.day === "Tomorrow"
      ? "Happy Hour Tomorrow"
      : `Happy Hour ${status.day}`;

  return (
    <div className="space-y-0.5">
      <p className="text-sm font-bold text-amber-700">{prefix}</p>
      <p className="text-sm text-gray-400">
        {status.startsAt} – {status.endsAt}
      </p>
    </div>
  );
}

// ─── SearchResultCard ─────────────────────────────────────────────────────────

type Props = {
  data: SearchResultCardData;
  /**
   * Which weekday's schedule this card's HH status should evaluate against
   * — passed by callers with a Day filter (see HhStatusDisplay above). Null
   * when that Day filter is set to "All Days". Omitted (undefined) by
   * callers with no Day filter concept.
   */
  effectiveDayName?: string | null;
  /**
   * Phase 4A — present ONLY when this card is rendered inside a curated
   * placement (a homepage rail/feature, or a guide) that has opted into
   * discovery tracking; see discoveryTracking.tsx. Ordinary search/listing
   * usage of this component (HappyHoursSearchClient and any other plain
   * results grid) never passes this, so it never fires a
   * venue_discover_events row — regular browse/search traffic must never
   * be misattributed as curated-placement traffic.
   */
  discovery?: DiscoveryContext;
};

export function SearchResultCard({ data, effectiveDayName, discovery }: Props) {
  return (
    // `<article>` (not the Link) is the outer element so the Save button
    // below can be an interactive sibling of the Link rather than nested
    // inside it — a <button> inside an <a> is invalid HTML and inaccessible
    // (nested interactive controls can't both be reached reliably by
    // keyboard/assistive tech). Same structural fix already applied to
    // EventSearchCard.tsx. `relative` moves here (from the old image
    // wrapper) so the Save button's absolute position is relative to this
    // shared ancestor of both siblings; hover styling moves from
    // group/group-hover to a plain `hover:` since the hoverable box and the
    // styled box are now the same element.
    <article
      className="
        relative
        bg-white rounded-2xl overflow-hidden
        border border-gray-100/80
        shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_14px_rgba(0,0,0,0.07)]
        hover:shadow-[0_2px_8px_rgba(0,0,0,0.04),0_14px_34px_rgba(0,0,0,0.10)]
        hover:-translate-y-[3px]
        transition-all duration-200
        flex flex-col
      "
    >
      <Link
        href={data.href}
        className="block cursor-pointer"
        // Scroll restoration is handled natively by the browser when using
        // Next.js Link + browser back. Enhanced session-storage restoration
        // can be added in a future pass once the Venue Detail page exists.
        //
        // Phase 4A: fire-and-forget click tracking, only when a curated
        // placement opted in via `discovery` — never blocks/delays
        // navigation (no preventDefault, no await), matching
        // (consumer)/home/VenueRailCard.tsx's existing click handler.
        onClick={discovery ? () => fireDiscoveryClick(data.venueUuid, discovery) : undefined}
      >
        {/* ── Hero Image ───────────────────────────────────────────────── */}
        <div className="relative h-[200px] overflow-hidden bg-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.image}
            alt={data.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Hide broken images gracefully — bg-gray-100 shows as placeholder
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />

          {/* Gradient — darkens the top edge so pills remain legible */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.26) 0%, rgba(0,0,0,0) 48%)",
            }}
            aria-hidden="true"
          />

          {/* Verified pill — top-left */}
          {data.isVerified && (
            <div className="absolute top-3 left-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full text-[11px] font-semibold bg-white/90 text-blue-700 backdrop-blur-[4px] shadow-sm leading-none">
                <svg
                  className="w-3 h-3 flex-shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                Verified Venue
              </span>
            </div>
          )}
        </div>

        {/* ── Content ──────────────────────────────────────────────────── */}
        <div className="px-4 py-3 flex flex-col flex-1 gap-1.5">

          {/* 1. Venue name — bold; first thing the eye finds */}
          <h3 className="text-[17px] font-bold text-gray-900 leading-tight tracking-tight line-clamp-2">
            {data.name}
          </h3>

          {/* 2. Google rating — quality signal, immediately below name */}
          {data.googleRating !== null && (
            <StarRating rating={data.googleRating} />
          )}

          {/* 3. Happy Hour status — time-sensitive decision signal */}
          <HhStatusDisplay
            happyHourWeekly={data.happyHourWeekly}
            effectiveDayName={effectiveDayName}
          />

          {/* 4. Distance + establishment type — convenience signal */}
          {(data.distanceKm !== null || data.establishmentType) && (
            <p className="flex items-center gap-1.5 text-sm text-gray-500">
              {data.distanceKm !== null && (
                <span className="font-medium text-gray-600">
                  {data.distanceKm.toFixed(1)} km
                </span>
              )}
              {data.distanceKm !== null && data.establishmentType && (
                <span className="text-gray-300" aria-hidden="true">•</span>
              )}
              {data.establishmentType && <span>{data.establishmentType}</span>}
            </p>
          )}

          {/* 5. Featured specials — always rendered so all cards share the same bottom section.
               mt-auto pins it to the card bottom regardless of how many items appear above. */}
          <div className="mt-auto pt-2 border-t border-gray-100 space-y-1">
            {data.foodSpecial && (
              <p className="text-sm font-medium text-gray-700">{data.foodSpecial}</p>
            )}
            {data.drinkSpecial && (
              <p className="text-sm font-medium text-gray-700">{data.drinkSpecial}</p>
            )}
            {!data.foodSpecial && !data.drinkSpecial && (
              <p className="text-sm font-medium text-amber-600">View Happy Hour details →</p>
            )}
          </div>

        </div>
      </Link>

      {/* Save button — sibling of the Link (not nested inside it), still
          visually positioned as a frosted circle over the image's top-right
          corner via the `relative` on this <article>. */}
      <div
        className="absolute top-2.5 right-3"
        style={{
          background: "rgba(255,255,255,0.88)",
          borderRadius: "50%",
          backdropFilter: "blur(4px)",
        }}
      >
        <SaveVenueButton venueId={data.venueUuid} variant="list" />
      </div>
    </article>
  );
}
