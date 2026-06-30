"use client";

import { useEffect, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  /** Shown below the venue name in the InfoWindow (e.g. "On Now", establishment type). */
  subtitle?: string;
  /** Navigates on InfoWindow "View details" click. Omit if no detail page exists yet. */
  href?: string;
};

// ─── BoundsManager ────────────────────────────────────────────────────────────

/**
 * Inner component — must live inside <APIProvider> to call useMap().
 * Fits the map to the initial marker set once on mount; does not re-fit
 * on subsequent filter changes so the user can pan/zoom freely.
 */
function BoundsManager({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");
  const hasFitted = useRef(false);

  useEffect(() => {
    if (!map || !coreLib || hasFitted.current || markers.length === 0) return;

    if (markers.length === 1) {
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(15);
    } else {
      const bounds = new coreLib.LatLngBounds();
      markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
      map.fitBounds(bounds, 60);
    }

    hasFitted.current = true;
  }, [map, coreLib, markers]);

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
  /** Tailwind classes applied to the root container (controls size, rounded corners, etc.). */
  className?: string;
};

export function SearchResultsMap({
  markers,
  marketCenter,
  marketZoom,
  className = "",
}: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const [selected, setSelected] = useState<MapMarker | null>(null);

  if (!apiKey) {
    return <MapFallback message="Map unavailable" className={className} />;
  }

  return (
    <div className={`${className}`}>
      <APIProvider apiKey={apiKey} version="quarterly">
        <Map
          defaultCenter={marketCenter}
          defaultZoom={marketZoom}
          gestureHandling="cooperative"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          cameraControl={false}
          zoomControl={true}
          style={{ width: "100%", height: "100%" }}
          onClick={() => setSelected(null)}
        >
          <BoundsManager markers={markers} />

          {markers.map((m) => (
            <Marker
              key={m.id}
              position={{ lat: m.lat, lng: m.lng }}
              title={m.name}
              onClick={() => setSelected(m)}
            />
          ))}

          {selected && (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => setSelected(null)}
            >
              <div style={{ maxWidth: 200 }}>
                <p
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    margin: 0,
                    color: "#111827",
                  }}
                >
                  {selected.name}
                </p>
                {selected.subtitle && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      margin: "3px 0 0",
                    }}
                  >
                    {selected.subtitle}
                  </p>
                )}
                {selected.href && (
                  <a
                    href={selected.href}
                    style={{
                      display: "block",
                      marginTop: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#ffffff",
                      background: "#f59e0b",
                      borderRadius: 6,
                      padding: "4px 10px",
                      textDecoration: "none",
                      textAlign: "center",
                    }}
                  >
                    View details →
                  </a>
                )}
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
