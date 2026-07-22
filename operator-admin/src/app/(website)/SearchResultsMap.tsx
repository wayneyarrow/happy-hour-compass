"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { LatLngBounds } from "@/lib/geo";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  /** Venue or event thumbnail shown in the InfoWindow. */
  image?: string;
  /** Line 2 of the InfoWindow — HH status, event title, establishment type, etc. */
  subtitle?: string;
  /** Controls subtitle text colour. Defaults to "gray". */
  subtitleColor?: "green" | "amber" | "gray";
  /** Line 3 — rating · distance, date/time, etc. */
  metaLine?: string;
  /** InfoWindow "View Details" link. Omit when no destination page exists. */
  href?: string;
};

// ─── HHC pin icon builder ─────────────────────────────────────────────────────
// Reproduces the hhc-icon.png design as an SVG data URL (transparent background,
// scalable, no rectangular box artifact that the PNG would produce on the map).
//
// Default:  dark-teal pin (#1e3d5c) + white interior circle + orange glass (#f4722e)
// Active:   orange pin (#f4722e) + white glass — color-inverted for clear distinction

function buildHhcPinUrl(active: boolean): string {
  const pinFill   = active ? "#f4722e" : "#1e3d5c";
  const glassFill = active ? "#ffffff" : "#f4722e";
  const accentFill = active ? "#ffffff" : "#1e3d5c";
  // The white interior circle is only used for the default (teal) state;
  // on the active (orange) state the glass sits directly on the orange body.
  const interiorCircle = active
    ? ""
    : `<circle cx="16" cy="14" r="9.5" fill="#ffffff"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42">` +
    // Pin body — teardrop matching the HHC logo proportions
    `<path d="M16,1C8.3,1,2,7.3,2,15C2,25.5,16,41,16,41C16,41,30,25.5,30,15C30,7.3,23.7,1,16,1Z" fill="${pinFill}"/>` +
    interiorCircle +
    // Cocktail bowl (inverted triangle)
    `<path d="M9.5,9L22.5,9L17,17L15,17Z" fill="${glassFill}"/>` +
    // Stem
    `<rect x="15.5" y="17" width="1" height="3.5" fill="${accentFill}"/>` +
    // Base
    `<rect x="12.5" y="20.5" width="7" height="1.3" fill="${accentFill}"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// ─── InfoWindow content ───────────────────────────────────────────────────────
// Uses inline styles throughout — Google Maps InfoWindows render in a separate
// DOM layer that may not inherit Tailwind utility classes.

function MarkerInfoWindow({ marker }: { marker: MapMarker }) {
  const subtitleColour =
    marker.subtitleColor === "green"
      ? "#15803d"
      : marker.subtitleColor === "amber"
      ? "#b45309"
      : "#6b7280";

  return (
    <div style={{ maxWidth: 210, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* Thumbnail */}
      {marker.image && (
        <div
          style={{
            marginBottom: 8,
            height: 84,
            borderRadius: 6,
            overflow: "hidden",
            background: "#f3f4f6",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={marker.image}
            alt={marker.name}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      {/* Venue / venue name */}
      <p
        style={{
          margin: "0 0 3px",
          fontWeight: 700,
          fontSize: 13,
          color: "#111827",
          lineHeight: 1.3,
        }}
      >
        {marker.name}
      </p>

      {/* Subtitle — HH status, event title, establishment type */}
      {marker.subtitle && (
        <p
          style={{
            margin: "0 0 2px",
            fontSize: 11.5,
            lineHeight: 1.35,
            color: subtitleColour,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {marker.subtitleColor === "green" && (
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#22c55e",
                flexShrink: 0,
              }}
            />
          )}
          {marker.subtitle}
        </p>
      )}

      {/* Meta line — rating, distance, date */}
      {marker.metaLine && (
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 11,
            color: "#9ca3af",
            lineHeight: 1.3,
          }}
        >
          {marker.metaLine}
        </p>
      )}

      {/* CTA */}
      {marker.href && (
        <a
          href={marker.href}
          style={{
            display: "block",
            marginTop: marker.metaLine || marker.subtitle ? 4 : 6,
            padding: "5px 12px",
            background: "#f59e0b",
            color: "#fff",
            borderRadius: 5,
            fontSize: 11.5,
            fontWeight: 600,
            textDecoration: "none",
            textAlign: "center",
            letterSpacing: "0.01em",
          }}
        >
          View Details →
        </a>
      )}
    </div>
  );
}

// ─── MapInnards ───────────────────────────────────────────────────────────────
// Lives inside <Map> so it can call useMap() and useMapsLibrary().
// Handles bounds-fitting, custom icon construction, markers, and InfoWindow.

type MapInnardsProps = {
  markers: MapMarker[];
  hoveredMarkerId: string | null;
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
};

function MapInnards({
  markers,
  hoveredMarkerId,
  selectedId,
  onSelectId,
}: MapInnardsProps) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");
  // Tracks the sorted ID set of the last fitted marker group so we only refit
  // when the visible result set changes (filter changes), not on sort order changes.
  const prevFitKeyRef = useRef("");

  // Refit bounds when the coordinate set meaningfully changes.
  useEffect(() => {
    if (!map || !coreLib || markers.length === 0) return;

    const fitKey = markers
      .map((m) => m.id)
      .sort()
      .join(",");
    if (fitKey === prevFitKeyRef.current) return;
    prevFitKeyRef.current = fitKey;

    if (markers.length === 1) {
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(15);
    } else {
      const bounds = new coreLib.LatLngBounds();
      markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
      map.fitBounds(bounds, 60);
    }
  }, [map, coreLib, markers]);

  // Build HHC pin icons once the core library is ready (Size + Point constructors).
  // Falls back to undefined (default Google red marker) while coreLib loads.
  const icons = useMemo(() => {
    if (!coreLib) return null;
    return {
      default: {
        url: buildHhcPinUrl(false),
        scaledSize: new coreLib.Size(28, 37),
        anchor: new coreLib.Point(14, 37),
      },
      active: {
        url: buildHhcPinUrl(true),
        scaledSize: new coreLib.Size(36, 47),
        anchor: new coreLib.Point(18, 47),
      },
    };
  }, [coreLib]);

  const selectedMarker = selectedId
    ? (markers.find((m) => m.id === selectedId) ?? null)
    : null;

  return (
    <>
      {markers.map((m) => {
        const isActive = m.id === hoveredMarkerId || m.id === selectedId;
        return (
          <Marker
            key={m.id}
            position={{ lat: m.lat, lng: m.lng }}
            title={m.name}
            // icons is null briefly while coreLib loads — undefined falls back to
            // the default Google red marker, then swaps to the custom amber pin.
            icon={icons ? (isActive ? icons.active : icons.default) : undefined}
            zIndex={isActive ? 10 : 1}
            onClick={() => onSelectId(selectedId === m.id ? null : m.id)}
          />
        );
      })}

      {selectedMarker && (
        <InfoWindow
          position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
          onCloseClick={() => onSelectId(null)}
        >
          <MarkerInfoWindow marker={selectedMarker} />
        </InfoWindow>
      )}
    </>
  );
}

// ─── Resize handler ───────────────────────────────────────────────────────────
// Google Maps doesn't detect its container being resized via CSS (e.g. the
// mobile map growing into its expanded "interaction mode") — it must be told
// explicitly via the "resize" event, same pattern VenueMapView.tsx's
// MapCenterManager already uses after mount. Firing after a short delay lets
// the CSS height transition finish before the map recalculates its viewport.

function MapResizeHandler({ signal }: { signal: unknown }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const timer = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).google?.maps?.event?.trigger(map, "resize");
    }, 320);
    return () => clearTimeout(timer);
  }, [map, signal]);
  return null;
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function MapFallback({ message, className = "" }: { message: string; className?: string }) {
  return (
    <div
      className={`bg-gray-50 border border-gray-100 flex flex-col items-center justify-center gap-3 text-gray-300 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-9 h-9"
        aria-hidden="true"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

// ─── SearchResultsMap ─────────────────────────────────────────────────────────

type Props = {
  markers: MapMarker[];
  marketCenter: { lat: number; lng: number };
  marketZoom: number;
  /** Tailwind classes applied to the root container (size, rounded corners, etc.). */
  className?: string;
  /**
   * ID of the marker that corresponds to the card currently being hovered.
   * Passed from the parent so card hover highlights the matching map pin.
   */
  hoveredMarkerId?: string | null;
  /**
   * Called when a marker is clicked (passes the marker id) or the InfoWindow
   * is closed (passes null). Parent uses this to highlight the matching card.
   */
  onMarkerClick?: (id: string | null) => void;
  /**
   * Google Maps gesture handling mode. Defaults to "cooperative" (existing
   * behavior everywhere): a single finger scrolls the page instead of panning
   * the map. Callers can pass "greedy" for a deliberately-entered interaction
   * mode where the map should take over single-finger gestures.
   */
  gestureHandling?: "cooperative" | "greedy";
  /**
   * Fires after pan/zoom settles (Maps' "idle" event), with the map's current
   * viewport bounds — or null if bounds aren't available yet. Omit to opt out
   * entirely (default); nothing is wired up or computed when absent, so
   * existing callers are unaffected.
   */
  onBoundsChanged?: (bounds: LatLngBounds | null) => void;
  /**
   * Any value that changes when this map's container size changes outside of
   * a window resize (e.g. an expand/collapse toggle). Triggers a Maps
   * "resize" event so the map redraws to fill its new container. Omit for
   * containers whose size never changes after mount (existing behavior).
   */
  resizeSignal?: unknown;
};

export function SearchResultsMap({
  markers,
  marketCenter,
  marketZoom,
  className = "",
  hoveredMarkerId = null,
  onMarkerClick,
  gestureHandling = "cooperative",
  onBoundsChanged,
  resizeSignal,
}: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleSelectId(id: string | null) {
    setSelectedId(id);
    onMarkerClick?.(id);
  }

  if (!apiKey) {
    return <MapFallback message="Map unavailable" className={className} />;
  }

  return (
    <div className={className}>
      <APIProvider apiKey={apiKey} version="quarterly">
        <Map
          defaultCenter={marketCenter}
          defaultZoom={marketZoom}
          gestureHandling={gestureHandling}
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          cameraControl={false}
          zoomControl={true}
          style={{ width: "100%", height: "100%" }}
          onClick={() => handleSelectId(null)}
          onIdle={(e) => {
            if (!onBoundsChanged) return;
            const b = e.map.getBounds();
            onBoundsChanged(b ? b.toJSON() : null);
          }}
        >
          <MapInnards
            markers={markers}
            hoveredMarkerId={hoveredMarkerId}
            selectedId={selectedId}
            onSelectId={handleSelectId}
          />
          {resizeSignal !== undefined && <MapResizeHandler signal={resizeSignal} />}
        </Map>
      </APIProvider>
    </div>
  );
}
