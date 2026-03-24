"use client";

/**
 * TEMPORARY DIAGNOSTIC CLIENT — MapTestClient
 * Delete alongside /map-test/page.tsx once diagnosis is complete.
 */
import { APIProvider, Map, Marker, InfoWindow } from "@vis.gl/react-google-maps";
import { useState } from "react";

type MarkerData = { name: string; lat: number; lng: number };

const DEFAULT_CENTER = { lat: 49.8928, lng: -119.4964 };

export function MapTestClient({ markers }: { markers: MarkerData[] }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const [selected, setSelected] = useState<MarkerData | null>(null);

  if (!apiKey) {
    return (
      <div style={{ padding: 16, color: "#c00" }}>
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not set.
      </div>
    );
  }

  return (
    /*
     * No overflow: hidden, no fixed phone-frame dimensions, no scroll containers.
     * Plain div with explicit pixel height so Google Maps can measure it.
     */
    <div style={{ width: "100%", height: 600, border: "1px solid #ccc" }}>
      <APIProvider apiKey={apiKey} version="quarterly">
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={14}
          gestureHandling="greedy"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          style={{ width: "100%", height: "100%" }}
          onClick={() => setSelected(null)}
        >
          {markers.map((m) => (
            <Marker
              key={m.name}
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
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                <strong>{selected.name}</strong>
                <br />
                {selected.lat}, {selected.lng}
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
