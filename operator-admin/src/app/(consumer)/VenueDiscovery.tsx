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
      className="w-[18px] h-[18px] shrink-0"
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
      className="w-[18px] h-[18px] shrink-0"
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
      {/* Search header */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 pt-5 pb-4">
        <div className="max-w-2xl mx-auto">

          {/* Search input + view toggle */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="search"
                placeholder="Search venues..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
            </div>

            {/* View toggle — shows target view; original design from index.html */}
            <button
              type="button"
              onClick={() => setView(isMap ? "list" : "map")}
              className="flex items-center gap-1.5 h-12 px-3 bg-white border border-gray-300 rounded-xl text-sm font-medium text-blue-500 shadow-sm hover:bg-gray-50 transition-colors shrink-0"
            >
              {isMap ? <ListIcon /> : <MapPinIcon />}
              {isMap ? "List" : "Map"}
            </button>
          </div>

          {/* Filter label */}
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Filter Results
          </p>

          {/* Scrollable chip row — bleeds to screen edges on mobile */}
          <div className="chips-scroll overflow-x-auto -mx-4 px-4">
            <div className="chips-inner flex gap-2 w-max pb-0.5">
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
                    className={
                      isActive
                        ? "px-3.5 py-1.5 rounded-full border border-blue-500 bg-blue-500 text-xs font-semibold text-white whitespace-nowrap shadow-[0_2px_4px_rgba(59,130,246,0.3)] shrink-0 transition-colors"
                        : "px-3.5 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-700 whitespace-nowrap hover:bg-gray-50 transition-colors shrink-0"
                    }
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Content area */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {isMap && (
          /* Map placeholder — matches original: 300px, rounded-lg, emerald border */
          <div className="flex flex-col items-center justify-center h-[300px] rounded-lg border-[3px] border-emerald-500 bg-white mb-5">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-10 h-10 text-gray-300 mb-3"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <p className="text-sm font-medium text-gray-400">
              Map view coming next
            </p>
          </div>
        )}

        {/* Venue count (map mode) or section label (list mode) */}
        {isMap ? (
          <p className="text-sm text-gray-500 mb-5">
            {filteredVenues.length} venue{filteredVenues.length !== 1 ? "s" : ""} found nearby
          </p>
        ) : (
          <p className="text-sm font-semibold text-gray-700 mb-4">
            All Venues
          </p>
        )}

        {/* Venue list or empty state — shown in both modes */}
        {filteredVenues.length === 0 ? (
          searchTerm ? (
            /* Empty state — matches original: 🔍 icon, "No matches" title, hint body */
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
