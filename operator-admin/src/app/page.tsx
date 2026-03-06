import Link from "next/link";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";

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
          <ul className="space-y-4">
            {venues.map((venue) => (
              <li key={venue.id}>
                <Link href={`/venue/${venue.id}`}>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition">
                    <h2 className="font-semibold text-gray-900">{venue.name}</h2>
                    {venue.city && (
                      <p className="text-xs text-gray-500 mt-0.5">{venue.city}</p>
                    )}
                    {venue.happyHourTagline && (
                      <p className="text-sm text-amber-700 mt-1">
                        {venue.happyHourTagline}
                      </p>
                    )}
                    {venue.events.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm text-gray-700">
                        {venue.events.map((event) => (
                          <li key={event.id}>
                            <span className="font-medium">{event.title}</span>
                            {event.nextOccurrenceLabel && (
                              <span className="ml-1 text-gray-500">
                                · {event.nextOccurrenceLabel}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
