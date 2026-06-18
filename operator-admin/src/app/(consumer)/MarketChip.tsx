"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findNearestActiveMarket, type Market } from "@/lib/markets";
import { setMarketAction } from "./marketActions";
import { MarketModal } from "./MarketModal";

type Props = {
  market: Market;
  /**
   * True when the user already has a persisted market cookie (manual or
   * previously auto-detected). When false, the chip runs one geolocation
   * attempt on mount to assign the best market automatically.
   */
  isPersisted: boolean;
};

export function MarketChip({ market, isPersisted }: Props) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Auto-detect market on first visit when no cookie is set.
  // Runs once after mount (inside ConsumerHome/VenueDiscovery, so after any
  // welcome gate animation has already started).
  useEffect(() => {
    if (isPersisted) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nearest = findNearestActiveMarket(coords.latitude, coords.longitude);
        startTransition(async () => {
          await setMarketAction(nearest.id);
          // Only refresh if the detected market differs from the current one;
          // otherwise just persist the default silently.
          if (nearest.id !== market.id) {
            router.refresh();
          }
        });
      },
      () => {
        // Permission denied or unavailable — keep the default market.
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        {/* Map pin icon */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9ca3af"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 13, height: 13, flexShrink: 0 }}
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>
          {market.name}
        </span>
        {/* Chevron down — signals tappability */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9ca3af"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 10, height: 10, flexShrink: 0 }}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isModalOpen && (
        <MarketModal
          activeMarketId={market.id}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
