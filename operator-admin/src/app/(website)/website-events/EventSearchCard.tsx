"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { WebsiteEventListItem } from "@/lib/data/events";
import { getEventTypeLabel, getEventTypeEmoji } from "@/lib/eventTypes";
import { SaveEventButton } from "@/app/(website)/SaveEventButton";
import { buildEventPublicPath } from "@/lib/publicEventUrl";

// ─── Date badge helpers ───────────────────────────────────────────────────────

const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAYS_PLURAL = [
  "SUNDAYS", "MONDAYS", "TUESDAYS", "WEDNESDAYS",
  "THURSDAYS", "FRIDAYS", "SATURDAYS",
];
const MONTHS_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Builds the two-line date badge shown on event cards.
 * Top line: day label (TODAY / TOMORROW / FRI / FRIDAYS / etc.)
 * Bottom line: date or time context
 */
function buildDateBadge(
  firstDate: string | null,
  recurrence: string | null,
  startTime: string | null
): { top: string; bottom: string | null } {
  // start_time is stored as human-readable "7:00 PM" (not HH:MM); use directly.
  const timeLabel = startTime ?? null;

  const now = new Date();
  const todayIso = localIso(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowIso = localIso(tomorrowDate);

  const isRecurring = recurrence && recurrence !== "none";

  if (!isRecurring) {
    // One-off event
    if (!firstDate) return { top: "DATE TBD", bottom: timeLabel };
    if (firstDate === todayIso) return { top: "TODAY", bottom: timeLabel };
    if (firstDate === tomorrowIso) return { top: "TOMORROW", bottom: timeLabel };

    // Parse date without timezone shift
    const [y, mo, d] = firstDate.split("-").map(Number);
    const date = new Date(y, mo - 1, d);
    const dayShort = DAYS_SHORT[date.getDay()];
    const monthDay = `${MONTHS_SHORT[date.getMonth()]} ${d}`;
    return { top: dayShort, bottom: monthDay };
  }

  // Recurring event
  if (recurrence === "daily") return { top: "DAILY", bottom: timeLabel };
  if (recurrence === "monthly") return { top: "MONTHLY", bottom: timeLabel };

  // Weekly / biweekly — derive day from firstDate
  if (firstDate) {
    const [y, mo, d] = firstDate.split("-").map(Number);
    const dow = new Date(y, mo - 1, d).getDay();
    const todayDow = now.getDay();
    const tomorrowDow = tomorrowDate.getDay();

    if (dow === todayDow) return { top: "TODAY", bottom: timeLabel };
    if (dow === tomorrowDow) return { top: "TOMORROW", bottom: timeLabel };

    return {
      top: DAYS_PLURAL[dow],
      bottom: recurrence === "biweekly" ? "BIWEEKLY" : timeLabel,
    };
  }

  return { top: "RECURRING", bottom: timeLabel };
}

// ─── DateBadge ────────────────────────────────────────────────────────────────

/**
 * Computes the badge client-side on mount (rather than during render) so it
 * always uses the viewer's actual wall-clock time — computing TODAY/TOMORROW
 * directly in the render body would run once during SSR (server timezone,
 * UTC on the deployment host) and again on client hydration (browser
 * timezone), producing mismatched HTML and a React hydration-mismatch error
 * whenever the two differ. Mirrors the mount-gated pattern used for the
 * venue-card happy-hour status (SearchResultCard.tsx / VenueActionCard.tsx).
 * Only the badge itself withholds rendering pre-mount — the rest of the
 * event card (image, title, save button, etc.) is unaffected.
 */
function DateBadge({
  firstDate,
  recurrence,
  startTime,
}: {
  firstDate: string | null;
  recurrence: string | null;
  startTime: string | null;
}) {
  const [badge, setBadge] = useState<{ top: string; bottom: string | null } | null>(null);

  useEffect(() => {
    setBadge(buildDateBadge(firstDate, recurrence, startTime));
  }, [firstDate, recurrence, startTime]);

  if (!badge) return null;

  return (
    <div
      className="
        absolute top-3 left-3
        inline-flex flex-col items-center
        px-2.5 py-1.5 rounded-xl
        bg-white/90 backdrop-blur-[4px] shadow-sm
        leading-none
      "
    >
      <span className="text-[10px] font-bold text-gray-900 tracking-wider">{badge.top}</span>
      {badge.bottom && (
        <span className="text-[10px] font-semibold text-amber-600 tracking-wide mt-0.5">
          {badge.bottom}
        </span>
      )}
    </div>
  );
}

// ─── Event image / placeholder ────────────────────────────────────────────────

function EventImagePlaceholder() {
  return (
    <div className="w-full h-full bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-2 opacity-60">
        <svg
          className="w-10 h-10 text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span className="text-[11px] font-semibold text-amber-500 tracking-wide">EVENT</span>
      </div>
    </div>
  );
}

// ─── EventSearchCard ──────────────────────────────────────────────────────────

type Props = {
  event: WebsiteEventListItem;
};

export function EventSearchCard({ event }: Props) {
  const typeLabel = getEventTypeLabel(event.eventType);
  const typeEmoji = getEventTypeEmoji(event.eventType);
  const showType = typeLabel && event.eventType !== "other";

  // Canonical slug path when the event's venue has resolvable market/city;
  // falls back to the UUID compatibility route otherwise — never a broken
  // or partial canonical path (see buildEventPublicPath).
  const href =
    buildEventPublicPath({
      marketSlug: event.marketSlug,
      citySlug: event.citySlug,
      eventSlug: event.slug,
    }) ?? `/website-events/${event.id}`;

  return (
    // `<article>` (not the Link) is the outer element so the Save button
    // below can be an interactive sibling of the Link rather than nested
    // inside it — a <button> inside an <a> is invalid HTML and inaccessible
    // (nested interactive controls can't both be reached reliably by
    // keyboard/assistive tech). `relative` moves here (from the old image
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
      "
    >
      <Link
        href={href}
        className="block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-2xl"
      >
        {/* ── Hero Image ───────────────────────────────────────────────── */}
        <div className="relative h-[200px] overflow-hidden bg-gray-100">
          {event.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.imageUrl}
              alt={event.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <EventImagePlaceholder />
          )}

          {/* Gradient — darkens top edge for legibility */}
          {event.imageUrl && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(0,0,0,0.26) 0%, rgba(0,0,0,0) 48%)",
              }}
              aria-hidden="true"
            />
          )}

          {/* Date badge — top-left */}
          <DateBadge
            firstDate={event.firstDate}
            recurrence={event.recurrence}
            startTime={event.startTime}
          />
        </div>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <div className="px-4 py-3 space-y-1.5">

          {/* 1. Event title — primary signal */}
          <h3 className="text-[17px] font-bold text-gray-900 leading-tight tracking-tight line-clamp-2">
            {event.title}
          </h3>

          {/* 2. Venue name */}
          {event.venueName && (
            <p className="text-sm font-semibold text-blue-600 leading-tight">
              {event.venueName}
            </p>
          )}

          {/* 3. Date / time label */}
          {event.nextOccurrenceLabel && (
            <p className="text-sm text-amber-700 font-medium">
              {event.nextOccurrenceLabel}
            </p>
          )}

          {/* 4. Venue type — context signal */}
          {event.venueEstablishmentType && (
            <p className="text-sm text-gray-500">{event.venueEstablishmentType}</p>
          )}

          {/* 5. Description — why attend */}
          {event.description && (
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-2 pt-0.5">
              {event.description}
            </p>
          )}

          {/* 6. Event type pill */}
          {showType && (
            <div className="pt-1.5 border-t border-gray-100">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-[11px] font-medium text-gray-600">
                <span aria-hidden="true">{typeEmoji}</span>
                {typeLabel}
              </span>
            </div>
          )}

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
        <SaveEventButton eventId={event.id} variant="list" />
      </div>
    </article>
  );
}
