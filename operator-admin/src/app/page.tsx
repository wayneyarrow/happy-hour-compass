import { USE_SUPABASE_VENUES } from "@/lib/flags";
import {
  getPublishedVenuesForConsumer,
  getVenuesFromCsv,
} from "@/lib/data/venues";

// Force a fresh Supabase query on every request — no static or router cache.
export const dynamic = "force-dynamic";

export default async function ConsumerHomePage() {
  const venues = USE_SUPABASE_VENUES
    ? await getPublishedVenuesForConsumer()
    : getVenuesFromCsv();

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          Happy Hour Compass
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Find the best happy hours near you.
        </p>

        {venues.length === 0 ? (
          <p className="text-gray-500 text-sm">No venues available right now.</p>
        ) : (
          <ul className="space-y-4">
            {venues.map((venue) => (
              <li
                key={venue.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
              >
                <h2 className="font-semibold text-gray-900">{venue.name}</h2>
                {venue.city && (
                  <p className="text-xs text-gray-500 mt-0.5">{venue.city}</p>
                )}
                {venue.happyHourTagline && (
                  <p className="text-sm text-amber-700 mt-1">
                    {venue.happyHourTagline}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
