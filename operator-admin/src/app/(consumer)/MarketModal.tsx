"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MARKETS, findNearestActiveMarket, type Market } from "@/lib/markets";
import { setMarketAction } from "./marketActions";

type Props = {
  activeMarketId: string;
  onClose: () => void;
};

export function MarketModal({ activeMarketId, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [comingSoonId, setComingSoonId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function handleSelect(market: Market) {
    if (market.status === "coming_soon") {
      setComingSoonId((prev) => (prev === market.id ? null : market.id));
      return;
    }
    if (market.id === activeMarketId) {
      onClose();
      return;
    }
    startTransition(async () => {
      await setMarketAction(market.id);
      router.refresh();
      onClose();
    });
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation || locating || isPending) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const nearest = findNearestActiveMarket(coords.latitude, coords.longitude);
        setLocating(false);
        startTransition(async () => {
          await setMarketAction(nearest.id);
          router.refresh();
          onClose();
        });
      },
      () => {
        setLocating(false);
      },
      { timeout: 8000 }
    );
  }

  const activeMarkets  = MARKETS.filter((m) => m.status === "active");
  const comingSoonMarkets = MARKETS.filter((m) => m.status === "coming_soon");

  return (
    <div
      className="md:pb-[max(0px,_calc(50dvh_-_406px))]"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 9000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      {/* Bottom sheet — stop propagation so taps inside don't close the modal */}
      <div
        className="w-full rounded-t-[20px] md:max-w-[375px] md:rounded-b-[30px]"
        style={{
          background: "white",
          padding: "20px 20px 44px",
          maxHeight: "min(82vh, 760px)",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div
          style={{
            width: 36,
            height: 4,
            background: "#e5e7eb",
            borderRadius: 2,
            margin: "0 auto 20px",
          }}
        />

        {/* Title */}
        <p style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 16 }}>
          Choose your market
        </p>

        {/* Use My Location */}
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={isPending || locating}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            background: "#eff6ff",
            border: "1.5px solid #bfdbfe",
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            color: isPending || locating ? "#93c5fd" : "#2563eb",
            cursor: isPending || locating ? "default" : "pointer",
            marginBottom: 22,
            transition: "color 150ms",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 16, height: 16, flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {locating ? "Detecting location…" : "Use My Location"}
        </button>

        {/* Active markets */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#9ca3af",
            marginBottom: 8,
          }}
        >
          Active markets
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
          {activeMarkets.map((market) => {
            const isActive = market.id === activeMarketId;
            return (
              <button
                key={market.id}
                type="button"
                onClick={() => handleSelect(market)}
                disabled={isPending}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  background: isActive ? "#f0fdf4" : "white",
                  border: `1.5px solid ${isActive ? "#86efac" : "#e5e7eb"}`,
                  borderRadius: 10,
                  padding: "13px 14px",
                  fontSize: 15,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "#166534" : "#374151",
                  cursor: isPending ? "default" : "pointer",
                  textAlign: "left",
                  transition: "background 150ms, border-color 150ms",
                }}
              >
                {market.name}
                {isActive && (
                  <span style={{ fontSize: 16, color: "#16a34a", flexShrink: 0 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Coming soon markets */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#9ca3af",
            marginBottom: 8,
          }}
        >
          Coming soon
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {comingSoonMarkets.map((market) => (
            <div key={market.id}>
              <button
                type="button"
                onClick={() => handleSelect(market)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  background: "#f9fafb",
                  border: "1.5px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "13px 14px",
                  fontSize: 15,
                  fontWeight: 400,
                  color: "#9ca3af",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {market.name}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    background: "#f3f4f6",
                    color: "#6b7280",
                    borderRadius: 6,
                    padding: "2px 7px",
                    flexShrink: 0,
                  }}
                >
                  Coming Soon
                </span>
              </button>
              {comingSoonId === market.id && (
                <p
                  style={{
                    fontSize: 13,
                    color: "#6b7280",
                    marginTop: 6,
                    marginLeft: 4,
                    lineHeight: 1.4,
                  }}
                >
                  {market.name} is coming soon — stay tuned!
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
