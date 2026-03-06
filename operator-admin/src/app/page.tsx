import Link from "next/link";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { VenueList } from "./VenueList";

// Force a fresh Supabase query on every request — no static or router cache.
export const dynamic = "force-dynamic";

export default async function ConsumerHomePage() {
  const venues = await getPublishedVenuesForConsumer();

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          Happy Hour Compass
        </h1>
        <p className="text-sm text-gray-500 mb-4">
          Find the best happy hours near you.
        </p>

        <div className="flex gap-2 mb-6">
          <span className="px-4 py-2 rounded-full bg-amber-500 text-white text-sm font-semibold">
            Venues
          </span>
          <Link
            href="/events"
            className="px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Events
          </Link>
        </div>

        {venues.length === 0 ? (
          <p className="text-gray-500 text-sm">No venues available right now.</p>
        ) : (
          <VenueList venues={venues} />
        )}
      </div>
    </main>
  );
}
