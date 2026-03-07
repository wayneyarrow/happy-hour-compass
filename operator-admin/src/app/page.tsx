import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { VenueDiscovery } from "./VenueDiscovery";

// Force a fresh Supabase query on every request — no static or router cache.
export const dynamic = "force-dynamic";

export default async function ConsumerHomePage() {
  const venues = await getPublishedVenuesForConsumer();

  return (
    <main className="min-h-screen bg-gray-50">
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
