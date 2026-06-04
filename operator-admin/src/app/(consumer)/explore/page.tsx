import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { isNearMarket } from "@/lib/discover/discoverEngine";
import { VenueDiscovery } from "../VenueDiscovery";

export const metadata: Metadata = {
  title: { absolute: "Explore — Happy Hour Compass" },
};

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const allVenues = await getPublishedVenuesForConsumer();
  // Scope search results to the active market — same geography gate used by all discover rails.
  const venues = allVenues.filter((v) => isNearMarket(v.latitude, v.longitude));
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
      <VenueDiscovery venues={venues} />
    </main>
  );
}
