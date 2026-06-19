"use client";

import Link from "next/link";
import type { DiscoverEventItem } from "@/lib/discover/discoverEngine";

/**
 * HomeEventItem — re-exported from the Discover Engine for backwards compat.
 * UI components that import this type continue to work without changes.
 */
export type HomeEventItem = DiscoverEventItem;

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
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid #eeeeee",
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
          transition: "box-shadow 0.18s, border-color 0.18s, transform 0.18s",
          height: "100%",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 12px 28px rgba(0,0,0,0.16)";
          el.style.borderColor = "#d1d5db";
          el.style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)";
          el.style.borderColor = "#eeeeee";
          el.style.transform = "translateY(0)";
        }}
      >
        {/* ── Accent header — rich amber gradient with overlay ────────────────── */}
        <div
          style={{
            position: "relative",
            height: 116,
            background: "linear-gradient(140deg, #78350f 0%, #92400e 50%, #b45309 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {/* Texture overlay */}
          <div style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at top right, rgba(255,255,255,0.12) 0%, transparent 60%)",
            pointerEvents: "none",
          }} />
          {/* Frosted circle with emoji */}
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.20)",
              backdropFilter: "blur(4px)",
              border: "1px solid rgba(255,255,255,0.30)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              lineHeight: 1,
            }}
          >
            🎉
          </div>
          {/* "Event" label */}
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "1.2px",
            textTransform: "uppercase",
          }}>Event</span>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────────── */}
        <div style={{ padding: "13px 13px 12px" }}>

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
                fontWeight: 600,
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
                fontSize: 11,
                color: "#9ca3af",
                fontWeight: 500,
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
