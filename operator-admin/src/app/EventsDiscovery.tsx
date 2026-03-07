"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConsumerEventListItem } from "@/lib/data/events";
import { BookmarkButton } from "./BookmarkButton";

type Props = {
  events: ConsumerEventListItem[];
};

/** Returns the ISO "YYYY-MM-DD" string for today in local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Returns the ISO date strings for "this weekend" (nearest Saturday + Sunday).
 * If today is Saturday, returns today + tomorrow.
 * If today is Sunday, returns yesterday + today.
 * Otherwise returns the upcoming Saturday + Sunday.
 */
function thisWeekendIsos(): string[] {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const offset = (d: number) => {
    const dt = new Date(today);
    dt.setDate(today.getDate() + d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };

  if (dow === 6) return [offset(0), offset(1)]; // Sat + Sun
  if (dow === 0) return [offset(-1), offset(0)]; // Sat + Sun
  const daysToSat = 6 - dow;
  return [offset(daysToSat), offset(daysToSat + 1)];
}

const isRecurring = (e: ConsumerEventListItem) =>
  e.recurrence != null && e.recurrence !== "none";

export function EventsDiscovery({ events }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [happeningTodayActive, setHappeningTodayActive] = useState(false);
  const [thisWeekendActive, setThisWeekendActive] = useState(false);

  // ── Filter pipeline ────────────────────────────────────────────────────────
  const today = todayIso();
  const weekendDates = thisWeekendIsos();

  const filtered = events
    .filter((e) =>
      searchTerm
        ? e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          e.venueName.toLowerCase().includes(searchTerm.toLowerCase())
        : true
    )
    .filter((e) =>
      happeningTodayActive
        ? isRecurring(e) || e.firstDate === today
        : true
    )
    .filter((e) =>
      thisWeekendActive
        ? isRecurring(e) ||
          (e.firstDate != null && weekendDates.includes(e.firstDate))
        : true
    );

  const anyFilterActive = happeningTodayActive || thisWeekendActive;

  return (
    <>
      {/* Search header — mirrors VenueDiscovery header */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 pt-5 pb-4">
        <div className="max-w-2xl mx-auto">

          {/* Search input */}
          <div className="relative mb-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>

          {/* Filter label */}
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Filter events
          </p>

          {/* Filter chips — matches original events-filters */}
          <div className="flex gap-2">
            {(
              [
                {
                  label: "Happening Today",
                  active: happeningTodayActive,
                  toggle: () => setHappeningTodayActive((v) => !v),
                },
                {
                  label: "This Weekend",
                  active: thisWeekendActive,
                  toggle: () => setThisWeekendActive((v) => !v),
                },
              ] as const
            ).map(({ label, active, toggle }) => (
              <button
                key={label}
                type="button"
                onClick={toggle}
                className={
                  active
                    ? "px-3.5 py-1.5 rounded-full border border-blue-500 bg-blue-500 text-xs font-semibold text-white whitespace-nowrap shadow-[0_2px_4px_rgba(59,130,246,0.3)] shrink-0 transition-colors"
                    : "px-3.5 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-700 whitespace-nowrap hover:bg-gray-50 transition-colors shrink-0"
                }
              >
                {label}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <p className="text-sm font-semibold text-gray-700 mb-4">All Events</p>

        {filtered.length === 0 ? (
          /* Empty state — matches original: 🎉 icon, "No events found" */
          <div className="flex flex-col items-center justify-center text-center py-16 px-10">
            <div className="text-5xl opacity-50 mb-4">🎉</div>
            <p className="text-lg font-semibold text-gray-700 mb-2">
              No events found
            </p>
            <p className="text-sm text-gray-500">
              {anyFilterActive || searchTerm
                ? "Try adjusting your filters or check back later for new events."
                : "Check back soon — events will appear here."}
            </p>
          </div>
        ) : (
          /* Event list — card style matches original .event-item */
          <ul className="space-y-px">
            {filtered.map((event) => (
              <li key={event.id}>
                <Link href={`/event/${event.id}`}>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3 hover:shadow-md transition">
                    {event.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={event.imageUrl}
                        alt={event.title}
                        className="w-full object-cover rounded-lg mb-3"
                        style={{ maxHeight: "140px" }}
                      />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Title — bold, matches .event-title */}
                        <p className="font-semibold text-gray-900 text-base leading-snug mb-0.5">
                          {event.title}
                        </p>
                        {/* Venue — blue, matches .event-venue */}
                        {event.venueName && (
                          <p className="text-sm font-medium text-blue-500 mb-0.5">
                            {event.venueName}
                          </p>
                        )}
                        {/* Schedule — gray, matches .event-time */}
                        {event.nextOccurrenceLabel && (
                          <p className="text-sm text-gray-500">
                            {event.nextOccurrenceLabel}
                          </p>
                        )}
                        {event.description && (
                          <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">
                            {event.description}
                          </p>
                        )}
                      </div>
                      <BookmarkButton venueId={event.venueId} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
