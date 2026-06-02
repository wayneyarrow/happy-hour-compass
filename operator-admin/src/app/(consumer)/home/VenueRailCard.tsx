"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BookmarkButton } from "../BookmarkButton";
import type { ConsumerVenue } from "@/lib/data/venues";

// ─── time helpers ─────────────────────────────────────────────────────────────

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

type HhStatus = { happening: boolean; nextLabel: string | null };

function computeHhStatus(happyHourWeekly: ConsumerVenue["happyHourWeekly"]): HhStatus {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayName = DAYS[now.getDay()];
  const todaySlots = happyHourWeekly[todayName] ?? [];

  const happening = todaySlots.some((slot) => {
    const [sh, sm] = slot.start.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin =
      slot.end === "close"
        ? 1440
        : (() => {
            const [eh, em] = slot.end.split(":").map(Number);
            return eh * 60 + em;
          })();
    return nowMin >= startMin && nowMin < endMin;
  });

  if (happening) return { happening: true, nextLabel: null };

  // Scan forward up to 7 days for the next upcoming slot
  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (now.getDay() + offset) % 7;
    const daySlots = happyHourWeekly[DAYS[dayIdx]] ?? [];
    for (const slot of daySlots) {
      const [sh, sm] = slot.start.split(":").map(Number);
      const startMin = sh * 60 + sm;
      if (offset === 0 && startMin <= nowMin) continue; // already past today
      const h = sh > 12 ? sh - 12 : sh === 0 ? 12 : sh;
      const ampm = sh >= 12 ? "PM" : "AM";
      const t = sm === 0 ? `${h} ${ampm}` : `${h}:${sm.toString().padStart(2, "0")} ${ampm}`;
      return {
        happening: false,
        nextLabel: offset === 0 ? `Starts ${t}` : `${DAYS[dayIdx].slice(0, 3)} ${t}`,
      };
    }
  }

  return { happening: false, nextLabel: null };
}

// ─── image helper ─────────────────────────────────────────────────────────────

function getVenueImageSrc(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery") || t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

// ─── component ────────────────────────────────────────────────────────────────

type Props = { venue: ConsumerVenue };

/**
 * Portrait venue card for horizontal rails.
 * OpenTable-inspired: image on top, content below.
 * 152 px wide so 2.5 cards peek on a 375 px frame.
 */
export function VenueRailCard({ venue }: Props) {
  // Initialise to neutral to avoid SSR/hydration mismatch (time-dependent)
  const [hhStatus, setHhStatus] = useState<HhStatus>({ happening: false, nextLabel: null });

  useEffect(() => {
    setHhStatus(computeHhStatus(venue.happyHourWeekly));
  }, [venue.happyHourWeekly]);

  const imageSrc = venue.images[0]?.url ?? getVenueImageSrc(venue.establishmentType);
  const tagline =
    venue.happyHourTagline ||
    venue.specialsFood[0] ||
    venue.specialsDrinks[0] ||
    "Happy Hour Specials";

  return (
    <Link
      href={`/venue/${venue.id}`}
      style={{ display: "block", width: 152, flexShrink: 0, textDecoration: "none" }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          transition: "box-shadow 0.15s, border-color 0.15s",
          height: "100%",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.13)";
          el.style.borderColor = "#d1d5db";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
          el.style.borderColor = "#e5e7eb";
        }}
      >
        {/* ── Image ──────────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 100,
            background: "#f3f4f6",
            overflow: "hidden",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={venue.name}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />

          {/* Bookmark — top-right, semi-transparent backing */}
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              background: "rgba(255,255,255,0.82)",
              borderRadius: "50%",
            }}
            onClick={(e) => e.preventDefault()}
          >
            <BookmarkButton venueId={venue.id} variant="list" />
          </div>

          {/* "On Now" badge — bottom-left */}
          {hhStatus.happening && (
            <div style={{ position: "absolute", bottom: 5, left: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 20,
                  background: "#dcfce7",
                  color: "#166534",
                  letterSpacing: "0.2px",
                }}
              >
                On Now
              </span>
            </div>
          )}
        </div>

        {/* ── Content ────────────────────────────────────────────────── */}
        <div style={{ padding: 9 }}>
          {/* Name */}
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#111827",
              lineHeight: 1.25,
              marginBottom: 2,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {venue.name}
          </p>

          {/* Establishment type */}
          {venue.establishmentType && (
            <p
              style={{
                fontSize: 10,
                color: "#9ca3af",
                marginBottom: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {venue.establishmentType}
            </p>
          )}

          {/* Tagline / specials preview */}
          <p
            style={{
              fontSize: 11,
              color: "#374151",
              lineHeight: 1.35,
              marginBottom: 5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {tagline}
          </p>

          {/* Meta row: verified, rating, next HH */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {venue.isVerified && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "#dbeafe",
                  color: "#1e40af",
                  flexShrink: 0,
                }}
              >
                ✓
              </span>
            )}
            {venue.googleRating !== null && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: "#6b7280",
                  flexShrink: 0,
                }}
              >
                ★ {venue.googleRating.toFixed(1)}
              </span>
            )}
            {!hhStatus.happening && hhStatus.nextLabel && (
              <span
                style={{
                  fontSize: 10,
                  color: "#9ca3af",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {hhStatus.nextLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
