"use client";

import { useState, useEffect } from "react";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { haversineKm } from "@/lib/geo";

type HHSlot = { start: string; end: string };

type Props = {
  happyHourWeekly: Record<string, HHSlot[]>;
  hoursWeekly: Record<string, string>;
  lat: number | null;
  lng: number | null;
  phone: string;
  websiteUrl: string;
  menuUrl: string | null;
  mapsUrl: string | null;
};

// ─── Open / Closed status ─────────────────────────────────────────────────────

const DAYS = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
] as const;

function parseAmPm(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function getOpenStatus(hoursWeekly: Record<string, string>): "Open Now" | "Closed" | null {
  const now = new Date();
  const entry = hoursWeekly[DAYS[now.getDay()]];
  if (!entry || entry === "CLOSED") return "Closed";
  const parts = entry.split(" - ");
  if (parts.length !== 2) return null;
  const open = parseAmPm(parts[0]);
  const close = parseAmPm(parts[1]);
  if (open === null || close === null || close <= open) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= open && nowMin < close ? "Open Now" : "Closed";
}

function getNextOpenInfo(hoursWeekly: Record<string, string>): string | null {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayIdx = now.getDay();
  const today = DAYS[todayIdx];

  // Is there an opening window later today?
  const todayEntry = hoursWeekly[today];
  if (todayEntry && todayEntry !== "CLOSED") {
    const parts = todayEntry.split(" - ");
    if (parts.length === 2) {
      const open = parseAmPm(parts[0]);
      if (open !== null && open > nowMin) return `Opens at ${parts[0].trim()}`;
    }
  }

  // Check the next 6 days
  for (let i = 1; i <= 6; i++) {
    const dayName = DAYS[(todayIdx + i) % 7];
    const entry = hoursWeekly[dayName];
    if (entry && entry !== "CLOSED") {
      const parts = entry.split(" - ");
      if (parts.length === 2) {
        const open = parseAmPm(parts[0]);
        if (open !== null) {
          return `Opens ${i === 1 ? "Tomorrow" : dayName} at ${parts[0].trim()}`;
        }
      }
    }
  }

  return null;
}

// ─── HH status label ─────────────────────────────────────────────────────────

function hhStatusLabel(weekly: Record<string, HHSlot[]>): {
  line1: string;
  line2?: string;
  isActive: boolean;
  isNone: boolean;
} {
  const status = computeHhStatus(weekly);
  if (status.type === "active") {
    return { line1: "Happy Hour On Now", line2: status.endsIn, isActive: true, isNone: false };
  }
  if (status.type === "upcoming") {
    const prefix = status.day === "Today" ? "Happy Hour Today" : `Happy Hour ${status.day}`;
    return { line1: prefix, line2: `Starts at ${status.startsAt}`, isActive: false, isNone: false };
  }
  return { line1: "No happy hour scheduled", isActive: false, isNone: true };
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({
  href,
  icon,
  label,
  subtle = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  subtle?: boolean;
}) {
  return (
    <a
      href={href}
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
  happyHourWeekly,
  hoursWeekly,
  lat,
  lng,
  phone,
  websiteUrl,
  menuUrl,
  mapsUrl,
}: Props) {
  const [openStatus, setOpenStatus] = useState<string | null>(null);
  const [nextOpen, setNextOpen] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  // Computed client-side on mount (rather than during render) so it always
  // uses the viewer's actual wall-clock time — computing it directly in the
  // render body would run once during SSR (server timezone) and again on
  // client hydration (browser timezone), producing mismatched HTML and a
  // React hydration-mismatch error whenever the two differ. Mirrors the
  // mounted-gate pattern VenueIdentityStatus.tsx already uses.
  const [hh, setHh] = useState<ReturnType<typeof hhStatusLabel> | null>(null);

  useEffect(() => {
    const status = getOpenStatus(hoursWeekly);
    setOpenStatus(status);
    setNextOpen(status === "Closed" ? getNextOpenInfo(hoursWeekly) : null);
  }, [hoursWeekly]);

  useEffect(() => {
    if (!navigator.geolocation || lat === null || lng === null) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setDistanceKm(haversineKm(coords.latitude, coords.longitude, lat, lng));
      },
      () => {},
      { timeout: 6000, maximumAge: 60_000 }
    );
  }, [lat, lng]);

  useEffect(() => {
    setHh(hhStatusLabel(happyHourWeekly));
  }, [happyHourWeekly]);

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
