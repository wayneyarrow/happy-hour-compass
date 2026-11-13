"use client";

import { useState, useEffect } from "react";
import {
  computeBusinessHoursStatus,
  computeHhStatus,
  type HhSchedule,
} from "@/lib/happyHourStatus";
import { displayDayAndTime, type TimeDisplay } from "@/lib/venueTimeDisplay";
import { useVenueTimeDisplay } from "@/app/(website)/useVenueTimeDisplay";
import { haversineKm } from "@/lib/geo";
import { trackVenueIntentClick } from "@/app/(website)/venueIntentTracking";
import { useBrowserLocation } from "@/app/(website)/useBrowserLocation";

type Props = {
  hhSchedule: HhSchedule;
  hoursWeekly: Record<string, string>;
  lat: number | null;
  lng: number | null;
  phone: string;
  websiteUrl: string;
  menuUrl: string | null;
  mapsUrl: string | null;
  /** Venue database UUID — for Website/Menu Intent tracking. */
  venueId: string;
};

// ─── Open / Closed status + HH status label ───────────────────────────────────
//
// Both are decided from the venue's own schedule, in the venue's timezone,
// at this instant (src/lib/happyHourStatus.ts) — never the visitor's clock.
// Only how the times read changes for a visitor in another timezone
// (converted + labelled, src/lib/venueTimeDisplay.ts).

function getOpenInfo(
  hoursWeekly: Record<string, string>,
  timeZone: string,
  display: TimeDisplay
): { status: "Open Now" | "Closed"; nextOpen: string | null } {
  const status = computeBusinessHoursStatus(hoursWeekly, timeZone);
  if (status.type === "open") return { status: "Open Now", nextOpen: null };
  if (!status.next) return { status: "Closed", nextOpen: null };
  const { day, time } = displayDayAndTime(display, status.next.opensAtMs, {
    day: status.next.day,
    time: status.next.opensAt,
  });
  return {
    status: "Closed",
    nextOpen: day === "Today" ? `Opens at ${time}` : `Opens ${day} at ${time}`,
  };
}

function hhStatusLabel(schedule: HhSchedule, display: TimeDisplay): {
  line1: string;
  line2?: string;
  isActive: boolean;
  isNone: boolean;
} {
  const status = computeHhStatus(schedule);
  if (status.type === "active") {
    return { line1: "Happy Hour On Now", line2: status.endsIn, isActive: true, isNone: false };
  }
  if (status.type === "upcoming") {
    const { day, time } = displayDayAndTime(display, status.startsAtMs, {
      day: status.day,
      time: status.startsAt,
    });
    const prefix = day === "Today" ? "Happy Hour Today" : `Happy Hour ${day}`;
    return { line1: prefix, line2: `Starts at ${time}`, isActive: false, isNone: false };
  }
  if (status.type === "allDay") {
    const prefix = status.day === "Today" ? "Happy Hour Today" : `Happy Hour ${status.day}`;
    return { line1: prefix, line2: "All Day", isActive: false, isNone: false };
  }
  return { line1: "No happy hour scheduled", isActive: false, isNone: true };
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({
  href,
  icon,
  label,
  subtle = false,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  subtle?: boolean;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className={`flex items-center gap-2.5 w-full px-4 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 ${
        subtle
          ? "py-2.5 text-gray-700 bg-gray-50 hover:bg-gray-100"
          : "py-3.5 text-white bg-amber-500 hover:bg-amber-600"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </a>
  );
}

// ─── VenueActionCard ─────────────────────────────────────────────────────────

export function VenueActionCard({
  hhSchedule,
  hoursWeekly,
  lat,
  lng,
  phone,
  websiteUrl,
  menuUrl,
  mapsUrl,
  venueId,
}: Props) {
  const [openStatus, setOpenStatus] = useState<string | null>(null);
  const [nextOpen, setNextOpen] = useState<string | null>(null);
  // Distance is shown only when the browser already has location permission
  // (read silently, never prompting) — see useBrowserLocation. No location
  // request is made on page load.
  const { coords: userCoords } = useBrowserLocation({ timeoutMs: 6000 });
  const distanceKm =
    userCoords && lat !== null && lng !== null
      ? haversineKm(userCoords.lat, userCoords.lng, lat, lng)
      : null;
  // Computed client-side on mount (rather than during render) so it always
  // uses the viewer's actual wall-clock time — computing it directly in the
  // render body would run once during SSR (server timezone) and again on
  // client hydration (browser timezone), producing mismatched HTML and a
  // React hydration-mismatch error whenever the two differ. Mirrors the
  // mounted-gate pattern VenueIdentityStatus.tsx already uses.
  const [hh, setHh] = useState<ReturnType<typeof hhStatusLabel> | null>(null);
  const display = useVenueTimeDisplay(hhSchedule.timeZone);

  useEffect(() => {
    if (!display) return;
    const info = getOpenInfo(hoursWeekly, hhSchedule.timeZone, display);
    setOpenStatus(info.status);
    setNextOpen(info.nextOpen);
  }, [hoursWeekly, hhSchedule.timeZone, display]);

  useEffect(() => {
    if (!display) return;
    setHh(hhStatusLabel(hhSchedule, display));
  }, [hhSchedule, display]);

  const hasSecondary = Boolean(menuUrl || websiteUrl || phone);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">

      {/* Status header — amber gradient when HH is active, clean white when not */}
      <div
        className={`px-5 pt-5 pb-4 border-b border-gray-100 transition-colors ${
          hh?.isActive
            ? "bg-gradient-to-br from-amber-50 to-orange-50/60"
            : "bg-white"
        }`}
      >
        {/* HH status — primary signal */}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            {hh?.isActive && (
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
            )}
            <p
              className={`text-sm leading-snug ${
                hh?.isActive
                  ? "font-bold text-amber-800"
                  : hh?.isNone
                  ? "font-normal text-gray-400"
                  : "font-bold text-gray-900"
              }`}
            >
              {hh?.line1 ?? ""}
            </p>
          </div>
          {hh?.line2 && (
            <p
              className={`text-xs mt-0.5 ${
                hh.isActive ? "text-amber-700/80 ml-4" : "text-gray-500"
              }`}
            >
              {hh.line2}
            </p>
          )}
        </div>

        {/* Open status + next-open + distance — secondary signals */}
        <div className="flex items-center gap-2 flex-wrap">
          {openStatus && (
            <>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    openStatus === "Open Now" ? "bg-green-500" : "bg-gray-300"
                  }`}
                  aria-hidden="true"
                />
                <span
                  className={`text-sm font-medium ${
                    openStatus === "Open Now" ? "text-green-700" : "text-gray-500"
                  }`}
                >
                  {openStatus}
                </span>
              </div>
              {openStatus === "Closed" && nextOpen && (
                <>
                  <span className="text-gray-200 select-none" aria-hidden="true">·</span>
                  <span className="text-xs text-gray-400">{nextOpen}</span>
                </>
              )}
            </>
          )}
          {distanceKm !== null && (
            <>
              {openStatus && (
                <span className="text-gray-200 select-none" aria-hidden="true">·</span>
              )}
              <span className="text-sm text-gray-400">
                {distanceKm < 1
                  ? `${Math.round(distanceKm * 1000)} m away`
                  : `${distanceKm.toFixed(1)} km away`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 pt-4 pb-4 space-y-2">
        {mapsUrl && (
          <ActionBtn
            href={mapsUrl}
            label="Get Directions"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
          />
        )}

        {/* Separator between primary and secondary actions */}
        {mapsUrl && hasSecondary && (
          <div className="border-t border-gray-100 !mt-3 !mb-1" />
        )}

        {menuUrl && (
          <ActionBtn
            href={menuUrl}
            subtle
            label="View Menu"
            onClick={() => trackVenueIntentClick(venueId, "menu")}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" ry="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="12" y2="16" />
              </svg>
            }
          />
        )}

        {websiteUrl && (
          <ActionBtn
            href={websiteUrl}
            subtle
            label="Visit Website"
            onClick={() => trackVenueIntentClick(venueId, "website")}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            }
          />
        )}

        {phone && (
          <ActionBtn
            href={`tel:${phone}`}
            subtle
            label="Call"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 8 19.79 19.79 0 0 1 1.04 4.11a2 2 0 0 1 1.72-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            }
          />
        )}
      </div>
    </div>
  );
}
