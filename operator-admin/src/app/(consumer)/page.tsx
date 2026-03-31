import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { VenueDiscovery } from "./VenueDiscovery";
import { WelcomeGate } from "./WelcomeGate";

export const metadata: Metadata = {
  title: { absolute: "Happy Hour Compass" },
};

// Force a fresh Supabase query on every request — no static or router cache.
export const dynamic = "force-dynamic";

export default async function ConsumerHomePage() {
  const venues = await getPublishedVenuesForConsumer();

  return (
    <main className="bg-gray-50">
      <style>{`
        @keyframes chip-scroll-hint {
          0%   { transform: translateX(0); }
          25%  { transform: translateX(-28px); }
          100% { transform: translateX(0); }
        }
        .chips-inner {
          animation: chip-scroll-hint 0.7s ease-in-out 0.8s both;
        }
        .chips-scroll::-webkit-scrollbar { display: none; }
        .chips-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/*
        WelcomeGate checks hhc_has_launched in localStorage:
        - First visit:      home screen (logo + tagline + CTA) until button clicked
        - Subsequent visit: splash screen (logo only, 1.2 s + 0.3 s fade)
        - After gate:       VenueDiscovery renders normally
      */}
      <WelcomeGate>
        <VenueDiscovery venues={venues} />
      </WelcomeGate>
    </main>
  );
}
