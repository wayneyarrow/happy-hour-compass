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
 * Landscape event card for the Featured Events horizontal rail.
 * 215 px wide so ~1.7 cards peek on a 375 px frame.
 */
export function EventRailCard({ event }: Props) {
  return (
    <Link
      href={`/event/${event.id}`}
      style={{ display: "block", width: 215, flexShrink: 0, textDecoration: "none" }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          padding: "12px 13px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
          transition: "box-shadow 0.15s, border-color 0.15s",
          minHeight: 80,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.11)";
          el.style.borderColor = "#d1d5db";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.07)";
          el.style.borderColor = "#e5e7eb";
        }}
      >
        {/* Icon + title */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>🎉</span>
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#111827",
              lineHeight: 1.3,
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {event.title}
          </p>
        </div>

        {/* Venue name */}
        {event.venueName && (
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#3b82f6",
              marginBottom: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {event.venueName}
          </p>
        )}

        {/* Schedule label */}
        {event.nextOccurrenceLabel && (
          <p style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.3, margin: 0 }}>
            {event.nextOccurrenceLabel}
          </p>
        )}
      </div>
    </Link>
  );
}
