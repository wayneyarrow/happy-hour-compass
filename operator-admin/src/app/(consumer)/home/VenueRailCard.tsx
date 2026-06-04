"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BookmarkButton } from "../BookmarkButton";
import type { ConsumerVenue } from "@/lib/data/venues";

// ─── status helpers ───────────────────────────────────────────────────────────

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

type CardStatus = {
  /**
   * "now"       — HH currently active
   * "today"     — HH occurs later today (not yet started)
   * "available" — venue offers HH but already ended today, not today, or another day
   * "none"      — no HH data
   */
  hhStatus: "now" | "today" | "available" | "none";
  /**
   * "open"  — venue is open right now
   * "closed"— venue is closed right now (hours data exists)
   * null    — no hours data configured; hide business status
   */
  businessStatus: "open" | "closed" | null;
};

const NEUTRAL: CardStatus = { hhStatus: "none", businessStatus: null };

function parseAmPmToMin(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function computeCardStatus(venue: ConsumerVenue): CardStatus {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayName = DAYS[now.getDay()];

  // ── Happy-hour status ─────────────────────────────────────────────────────
  const todaySlots = venue.happyHourWeekly[todayName] ?? [];

  const hhNow = todaySlots.some((slot) => {
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

  let hhStatus: CardStatus["hhStatus"];
  if (hhNow) {
    hhStatus = "now";
  } else {
    const hhLaterToday = todaySlots.some((slot) => {
      const [sh, sm] = slot.start.split(":").map(Number);
      return sh * 60 + sm > nowMin;
    });
    if (hhLaterToday) {
      hhStatus = "today";
    } else {
      const anyHhDay = DAYS.some((d) => (venue.happyHourWeekly[d] ?? []).length > 0);
      hhStatus = anyHhDay ? "available" : "none";
    }
  }

  // ── Business open/closed status ───────────────────────────────────────────
  // Return null (hide) when no hours have been configured for any day.
  const hasAnyHours = DAYS.some(
    (d) => venue.hoursWeekly[d] && venue.hoursWeekly[d] !== "CLOSED"
  );

  let businessStatus: CardStatus["businessStatus"] = null;
  if (hasAnyHours) {
    const entry = venue.hoursWeekly[todayName];
    if (!entry || entry === "CLOSED") {
      businessStatus = "closed";
    } else {
      const parts = entry.split(" - ");
      if (parts.length === 2) {
        const open = parseAmPmToMin(parts[0]);
        const close = parseAmPmToMin(parts[1]);
        if (open !== null && close !== null && close > open) {
          businessStatus = nowMin >= open && nowMin < close ? "open" : "closed";
        }
      }
    }
  }

  return { hhStatus, businessStatus };
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
 * Portrait venue card for horizontal rails — OpenTable-inspired.
 *
 * V1 status model (no times or schedules on card):
 *   Image badge:  "Happy Hour Now"  (green)  — when HH is currently active
 *   Status row:
 *     Business:   "Open Now"        (green pill)
 *                 "Closed"          (gray pill)   hidden when no hours data
 *     HH:         "Happy Hour Now"  (amber pill)
 *                 "Happy Hour Today"(amber pill)
 *                 "Happy Hour Available" (gray pill)
 *                 hidden when no HH data
 *     Rating:     ★ X.X             (plain text)  hidden when no rating
 *
 * Sizing: 240 px wide → ~1.4 cards visible on the 375 px phone frame.
 * Image: 148 px high (8:5 ratio).
 */
export function VenueRailCard({ venue }: Props) {
  // Initialise neutral — avoids SSR/hydration mismatch (all derived values are time-dependent)
  const [status, setStatus] = useState<CardStatus>(NEUTRAL);

  useEffect(() => {
    setStatus(computeCardStatus(venue));
  }, [venue]);

  const imageSrc = venue.images[0]?.url ?? getVenueImageSrc(venue.establishmentType);

  // HH status pill in the card content area.
  // When hhStatus === "now" the green image badge (bottom-left of photo) already
  // shows "Happy Hour Now" — suppress the pill here to avoid double-showing.
  const hhPill: { label: string; bg: string; color: string } | null =
    status.hhStatus === "today"
      ? { label: "Happy Hour Today",     bg: "#fef3c7", color: "#b45309" }
      : status.hhStatus === "available"
      ? { label: "Happy Hour Available", bg: "#f3f4f6", color: "#6b7280" }
      : null;

  return (
    <Link
      href={`/venue/${venue.id}`}
      style={{ display: "block", width: 240, flexShrink: 0, textDecoration: "none" }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
          boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
          transition: "box-shadow 0.18s, border-color 0.18s, transform 0.18s",
          height: "100%",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.15)";
          el.style.borderColor = "#d1d5db";
          el.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.10)";
          el.style.borderColor = "#e5e7eb";
          el.style.transform = "translateY(0)";
        }}
      >
        {/* ── Image ──────────────────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 148,
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

          {/* Subtle bottom scrim — grounds the content panel */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to bottom, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.18) 100%)",
              pointerEvents: "none",
            }}
          />

          {/* Bookmark — top-right, frosted circle */}
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "rgba(255,255,255,0.88)",
              borderRadius: "50%",
              backdropFilter: "blur(4px)",
            }}
            onClick={(e) => e.preventDefault()}
          >
            <BookmarkButton venueId={venue.id} variant="list" />
          </div>

          {/* "Happy Hour Now" image badge — bottom-left, only when HH is active */}
          {status.hhStatus === "now" && (
            <div style={{ position: "absolute", bottom: 9, left: 9 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: 20,
                  background: "#dcfce7",
                  color: "#166534",
                  letterSpacing: "0.1px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#16a34a",
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
                Happy Hour Now
              </span>
            </div>
          )}
        </div>

        {/* ── Content ────────────────────────────────────────────────────────── */}
        <div style={{ padding: 12 }}>

          {/* Venue name — primary hierarchy */}
          <p
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#111827",
              lineHeight: 1.2,
              marginBottom: 3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {venue.name}
          </p>

          {/* Venue type + Rating row
               Type truncates left; rating right-aligns via marginLeft:auto.
               Row is skipped when neither field has data. */}
          {(venue.establishmentType || venue.googleRating !== null) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {venue.establishmentType && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#9ca3af",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    letterSpacing: "0.1px",
                    minWidth: 0,
                    flex: "1 1 0",
                  }}
                >
                  {venue.establishmentType}
                </span>
              )}
              {venue.googleRating !== null && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#6b7280",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    marginLeft: "auto",
                  }}
                >
                  ⭐ {venue.googleRating.toFixed(1)}
                </span>
              )}
            </div>
          )}

          {/* ── Status row ─────────────────────────────────────────────────────
               Business status · HH status.
               No times, no schedules, no day references.
               Rating lives on the type row above. */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>

            {/* Business status — hidden when hours data is unavailable */}
            {status.businessStatus === "open" && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 5,
                  background: "#dcfce7",
                  color: "#166534",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                Open Now
              </span>
            )}
            {status.businessStatus === "closed" && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "2px 7px",
                  borderRadius: 5,
                  background: "#f3f4f6",
                  color: "#6b7280",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                Closed
              </span>
            )}

            {/* HH status pill — no times, no day refs */}
            {hhPill && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 5,
                  background: hhPill.bg,
                  color: hhPill.color,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {hhPill.label}
              </span>
            )}

          </div>
        </div>
      </div>
    </Link>
  );
}
