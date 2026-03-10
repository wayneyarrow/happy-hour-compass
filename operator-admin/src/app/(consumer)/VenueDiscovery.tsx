"use client";

import { useState } from "react";
import type { ConsumerVenue } from "@/lib/data/venues";
import { VenueList, getOpenStatus, isHappeningNow, haversineKm } from "./VenueList";

type View = "list" | "map";


const FILTER_CHIPS = [
  "Happening Now",
  "Near Me",
  "Open Now",
  "Sports Bars",
  "Fine Dining",
  "Under $10",
];

// SVG icons match original index.html design (mapPinIcon / listIcon)
function MapPinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 18, height: 18, flexShrink: 0 }}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 18, height: 18, flexShrink: 0 }}
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

type Props = {
  venues: ConsumerVenue[];
};

export function VenueDiscovery({ venues }: Props) {
  const [view, setView] = useState<View>("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [openNowActive, setOpenNowActive] = useState(false);
  const [sportsBarsActive, setSportsBarsActive] = useState(false);
  const [happeningNowActive, setHappeningNowActive] = useState(false);
  const [nearMeActive, setNearMeActive] = useState(false);
  const [fineDiningActive, setFineDiningActive] = useState(false);
  const [underTenActive, setUnderTenActive] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const isMap = view === "map";

  const NEAR_ME_RADIUS_KM = 25;

  const filteredVenues = venues
    .filter((v) =>
      searchTerm
        ? v.name.toLowerCase().includes(searchTerm.toLowerCase())
        : true
    )
    .filter((v) =>
      happeningNowActive ? isHappeningNow(v.happyHourWeekly) : true
    )
    .filter((v) =>
      openNowActive ? getOpenStatus(v.hoursWeekly) === "Open Now" : true
    )
    .filter((v) =>
      sportsBarsActive
        ? v.establishmentType?.toLowerCase().includes("sports bar")
        : true
    )
    .filter((v) => {
      if (!nearMeActive || !userLocation) return true;
      // Venues without coordinates are included (original behavior)
      if (v.latitude === null || v.longitude === null) return true;
      return haversineKm(userLocation.lat, userLocation.lng, v.latitude, v.longitude) <= NEAR_ME_RADIUS_KM;
    })
    .filter((v) =>
      fineDiningActive
        ? v.establishmentType?.toLowerCase() === "fine dining"
        : true
    )
    .filter((v) => (underTenActive ? v.hasUnderTenItem : true));

  function handleNearMeClick() {
    if (nearMeActive) {
      setNearMeActive(false);
      return;
    }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLocation({ lat: coords.latitude, lng: coords.longitude });
        setNearMeActive(true);
      },
      () => {
        // Permission denied or error — do not activate filter
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  }

  return (
    <>
      {/* Search + filter header — mirrors original search screen layout (white bg, 20px padding) */}
      <div className="bg-white border-b border-[#e5e7eb]" style={{ padding: "20px 20px 0" }}>

        {/* Search controls row: input + view toggle — mirrors .search-controls */}
        <div className="flex items-center gap-2">
          {/* Search wrapper */}
          <div className="relative flex-1">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#9ca3af]"
              style={{ fontSize: 18 }}
            >
              🔍
            </span>
            <input
              type="search"
              placeholder="Search venues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              style={{
                background: "white",
                border: "1px solid #d1d5db",
                borderRadius: 10,
                padding: "12px 12px 12px 40px",
                fontSize: 16,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                height: 48,
                boxSizing: "border-box",
                width: "100%",
              }}
            />
          </div>

          {/* View toggle — mirrors .view-toggle-btn */}
          <button
            type="button"
            onClick={() => setView(isMap ? "list" : "map")}
            className="flex items-center gap-1.5 text-[#3b82f6] font-medium text-[14px] whitespace-nowrap flex-shrink-0 hover:bg-[#f9fafb] transition-colors"
            style={{
              background: "white",
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              height: 48,
              boxSizing: "border-box",
            }}
          >
            {isMap ? <ListIcon /> : <MapPinIcon />}
            {isMap ? "List" : "Map"}
          </button>
        </div>

        {/* Filter section — mirrors .filter-section */}
        <div className="relative overflow-hidden">
          {/* Filter label — mirrors .filter-label */}
          <p
            className="text-[12px] font-semibold uppercase text-[#6b7280]"
            style={{ letterSpacing: "0.5px", padding: "12px 0 6px" }}
          >
            Filter results
          </p>

          {/* Scrollable chip row — bleeds to edge on mobile; mirrors .filters */}
          <div
            className="chips-scroll overflow-x-auto -mx-5 px-5"
            style={{ paddingBottom: 15 }}
          >
            <div className="chips-inner flex gap-[10px] w-max">
              {FILTER_CHIPS.map((chip) => {
                const isHappeningNowChip = chip === "Happening Now";
                const isNearMeChip = chip === "Near Me";
                const isOpenNowChip = chip === "Open Now";
                const isSportsBarsChip = chip === "Sports Bars";
                const isFineDiningChip = chip === "Fine Dining";
                const isUnderTenChip = chip === "Under $10";
                const isActive =
                  (isHappeningNowChip && happeningNowActive) ||
                  (isNearMeChip && nearMeActive) ||
                  (isOpenNowChip && openNowActive) ||
                  (isSportsBarsChip && sportsBarsActive) ||
                  (isFineDiningChip && fineDiningActive) ||
                  (isUnderTenChip && underTenActive);
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={
                      isHappeningNowChip
                        ? () => setHappeningNowActive((v) => !v)
                        : isNearMeChip
                        ? handleNearMeClick
                        : isOpenNowChip
                        ? () => setOpenNowActive((v) => !v)
                        : isSportsBarsChip
                        ? () => setSportsBarsActive((v) => !v)
                        : isFineDiningChip
                        ? () => setFineDiningActive((v) => !v)
                        : isUnderTenChip
                        ? () => setUnderTenActive((v) => !v)
                        : undefined
                    }
                    className="whitespace-nowrap shrink-0 transition-all"
                    style={
                      isActive
                        ? {
                            background: "#3b82f6",
                            color: "white",
                            border: "2px solid #3b82f6",
                            borderRadius: 20,
                            padding: "8px 16px",
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: "pointer",
                            boxShadow: "0 2px 4px rgba(59,130,246,0.3)",
                          }
                        : {
                            background: "white",
                            color: "#374151",
                            border: "2px solid #d1d5db",
                            borderRadius: 20,
                            padding: "8px 16px",
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: "pointer",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                          }
                    }
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right-edge gradient fade — mirrors .filter-section::after */}
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-0 w-[40px]"
            style={{
              background: "linear-gradient(to right, transparent, white)",
              zIndex: 1,
            }}
          />
        </div>

      </div>

      {/* Content area — mirrors .content: padding 20px */}
      <div style={{ padding: "20px 20px 140px" }}>
        {isMap && (
          /* Map placeholder — matches original: 300px, rounded-lg, emerald border */
          <div
            className="flex flex-col items-center justify-center mb-5"
            style={{
              height: 300,
              borderRadius: 8,
              border: "3px solid #10b981",
              background: "white",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-300 mb-3"
              style={{ width: 40, height: 40 }}
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <p className="text-sm font-medium text-gray-400">
              Map view coming next
            </p>
          </div>
        )}

        {/* Venue count in map mode */}
        {isMap && (
          <p className="text-sm text-gray-500 mb-5">
            {filteredVenues.length} venue{filteredVenues.length !== 1 ? "s" : ""} found nearby
          </p>
        )}

        {/* Venue list or empty state */}
        {filteredVenues.length === 0 ? (
          searchTerm ? (
            /* Empty state — mirrors original: 🔍 icon, "No matches" title, hint body */
            <div className="flex flex-col items-center justify-center text-center py-16 px-10">
              <div className="text-5xl opacity-50 mb-4">🔍</div>
              <p className="text-lg font-semibold text-gray-700 mb-2">No matches</p>
              <p className="text-sm text-gray-500">
                Try clearing filters or searching a different area.
              </p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No venues available right now.</p>
          )
        ) : (
          <VenueList venues={filteredVenues} />
        )}
      </div>
    </>
  );
}
