"use client";

import Link from "next/link";

/** Minimal event shape needed for the homepage events rail. */
export type HomeEventItem = {
  id: string;
  title: string;
  venueName: string;
  venueSlug: string;
  nextOccurrenceLabel: string;
};

type Props = { event: HomeEventItem };

/**
 * Event card for the Featured Events horizontal rail.
 *
 * Same 240 px width as VenueRailCard so the two rail types feel cohesive.
 * Uses an amber gradient header (no image URL in HomeEventItem) to give
 * visual weight comparable to the venue image above the fold.
 */
export function EventRailCard({ event }: Props) {
  return (
    <Link
      href={`/event/${event.id}`}
      style={{ display: "block", width: 240, flexShrink: 0, textDecoration: "none" }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
          boxShadow: "0 2px 8px rgba(0,0,0,0.09)",
          transition: "box-shadow 0.18s, border-color 0.18s, transform 0.18s",
          height: "100%",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.14)";
          el.style.borderColor = "#d1d5db";
          el.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.09)";
          el.style.borderColor = "#e5e7eb";
          el.style.transform = "translateY(0)";
        }}
      >
        {/* ── Accent header — amber gradient replaces image for events ───────── */}
        <div
          style={{
            height: 72,
            background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Frosted circle with emoji */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              lineHeight: 1,
            }}
          >
            🎉
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────────── */}
        <div style={{ padding: 12 }}>

          {/* Title — primary hierarchy */}
          <p
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#111827",
              lineHeight: 1.25,
              marginBottom: 5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {event.title}
          </p>

          {/* Venue name — secondary label */}
          {event.venueName && (
            <p
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "#3b82f6",
                marginBottom: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {event.venueName}
            </p>
          )}

          {/* Schedule — supporting detail */}
          {event.nextOccurrenceLabel && (
            <p
              style={{
                fontSize: 12,
                color: "#9ca3af",
                lineHeight: 1.35,
                margin: 0,
              }}
            >
              {event.nextOccurrenceLabel}
            </p>
          )}

        </div>
      </div>
    </Link>
  );
}
