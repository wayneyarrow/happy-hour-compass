"use client";

import { APIProvider, Map, Marker } from "@vis.gl/react-google-maps";

type Props = {
  lat: number | null;
  lng: number | null;
  venueName: string;
  mapsUrl: string | null;
};

function isValidCoords(lat: number | null, lng: number | null): lat is number {
  return lat !== null && lng !== null && !(lat === 0 && lng === 0);
}

function MapFallback({ message }: { message: string }) {
  return (
    <div className="h-52 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center gap-2.5 text-gray-300">
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

export function VenueDetailMap({ lat, lng, venueName, mapsUrl }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  if (!apiKey) {
    return <MapFallback message="Map unavailable" />;
  }

  if (!isValidCoords(lat, lng)) {
    return <MapFallback message="Location not available" />;
  }

  const position = { lat, lng: lng as number };

  return (
    <div className="h-52 rounded-2xl overflow-hidden border border-gray-100">
      <APIProvider apiKey={apiKey} version="quarterly">
        <Map
          defaultCenter={position}
          defaultZoom={15}
          gestureHandling="cooperative"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          cameraControl={false}
          zoomControl={true}
          style={{ width: "100%", height: "100%" }}
        >
          <Marker
            position={position}
            title={venueName}
            clickable={Boolean(mapsUrl)}
            onClick={() => {
              if (mapsUrl) window.open(mapsUrl, "_blank", "noopener,noreferrer");
            }}
          />
        </Map>
      </APIProvider>
    </div>
  );
}
