"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";
import type { ConsumerVenue } from "@/lib/data/venues";

type LatLng = { lat: number; lng: number };

/** ConsumerVenue narrowed to have confirmed non-null coordinates. */
type MappedVenue = ConsumerVenue & { latitude: number; longitude: number };

type Props = {
  venues: ConsumerVenue[];
};

/** Filters to venues with valid lat/lng coordinates. */
function venuesWithCoords(venues: ConsumerVenue[]): MappedVenue[] {
  return venues.filter(
    (v): v is MappedVenue => v.latitude !== null && v.longitude !== null
  );
}

/** Default map center — Kelowna, BC (matches placeholder coords in admin form). */
const DEFAULT_CENTER: LatLng = { lat: 49.888, lng: -119.496 };
const DEFAULT_ZOOM = 13;

/**
 * Inner component — must live inside <APIProvider> to call useMap().
 * Pans the map to userLocation when browser geolocation resolves.
 * Mirrors the geolocation pattern in VenueList.tsx.
 */
function MapCenterManager({ userLocation }: { userLocation: LatLng | null }) {
  const map = useMap();

  // After mount, trigger a Maps resize so the projection recalculates with the
  // container's final settled dimensions. Runs one frame after mount to ensure
  // the browser has completed layout.
  useEffect(() => {
    if (!map) return;
    const raf = requestAnimationFrame(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).google?.maps?.event?.trigger(map, "resize");
    });
    return () => cancelAnimationFrame(raf);
  }, [map]);

  useEffect(() => {
    if (map && userLocation) {
      map.panTo(userLocation);
    }
  }, [map, userLocation]);

  return null;
}

export function VenueMapView({ venues }: Props) {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const mapped = venuesWithCoords(venues);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [selectedVenue, setSelectedVenue] = useState<MappedVenue | null>(null);

  // Request geolocation on mount — same options/pattern as VenueList.tsx.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLocation({ lat: coords.latitude, lng: coords.longitude });
      },
      () => {
        // Permission denied or unavailable — map stays at DEFAULT_CENTER.
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, []);

  if (!apiKey) {
    return (
      <div
        className="flex items-center justify-center text-sm text-gray-400"
        style={{ height: 300, borderRadius: 8, border: "2px solid #e5e7eb", background: "white" }}
      >
        Map unavailable — API key not configured.
      </div>
    );
  }

  if (mapped.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center text-center"
        style={{ height: 300, borderRadius: 8, border: "2px solid #e5e7eb", background: "white" }}
      >
        <p className="text-sm font-medium text-gray-400">No venues with map coordinates yet.</p>
        <p className="text-xs text-gray-300 mt-1">Coordinates can be added in the operator admin.</p>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} version="quarterly">
      <div style={{ height: 300, borderRadius: 8, overflow: "hidden", border: "2px solid #e5e7eb" }}>
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          // Replace the newer Camera Control (combined zoom/tilt/rotate widget)
          // with the classic compact +/- zoom buttons only.
          cameraControl={false}
          zoomControl={true}
          style={{ width: "100%", height: "100%" }}
          // Close the InfoWindow when tapping the map background.
          onClick={() => setSelectedVenue(null)}
        >
          <MapCenterManager userLocation={userLocation} />

          {mapped.map((venue) => (
            // Marker (google.maps.Marker) has built-in correct bottom-center anchoring.
            // No custom anchor props needed — the pin tip sits exactly at the coordinate.
            <Marker
              key={venue.id}
              position={{ lat: venue.latitude, lng: venue.longitude }}
              title={venue.name}
              onClick={() => setSelectedVenue(venue)}
            />
          ))}

          {selectedVenue && (
            <InfoWindow
              position={{ lat: selectedVenue.latitude, lng: selectedVenue.longitude }}
              onCloseClick={() => setSelectedVenue(null)}
            >
              {/* Constrained width keeps the popup compact on mobile. */}
              <div style={{ maxWidth: 180 }}>
                <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: "#111827" }}>
                  {selectedVenue.name}
                </p>
                {(selectedVenue.happyHourTagline || selectedVenue.establishmentType) && (
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "3px 0 0" }}>
                    {selectedVenue.happyHourTagline || selectedVenue.establishmentType}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => router.push(`/venue/${selectedVenue.id}`)}
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#ffffff",
                    background: "#f59e0b",
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                    cursor: "pointer",
                    display: "block",
                    width: "100%",
                  }}
                >
                  View details →
                </button>
              </div>
            </InfoWindow>
          )}
        </Map>
      </div>
    </APIProvider>
  );
}
