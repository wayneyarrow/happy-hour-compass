import { notFound } from "next/navigation";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";

// Never serve a stale version — preview mode must always read live DB data.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function VenuePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  const isPreview =
    resolvedSearchParams.preview === "true" ||
    (Array.isArray(resolvedSearchParams.preview) &&
      resolvedSearchParams.preview.includes("true"));

  const venue = await getVenueWithEventsForConsumerById(id, {
    includeUnpublished: isPreview,
  });

  if (!venue) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto py-8 px-4">
        {isPreview && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
            Preview mode — this venue may not be publicly visible yet.
          </div>
        )}

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {venue.name}
        </h1>

        {venue.city && (
          <p className="text-sm text-gray-500 mb-2">{venue.city}</p>
        )}

        {venue.happyHourTagline && (
          <p className="text-base text-amber-700 mb-6">
            {venue.happyHourTagline}
          </p>
        )}

        {venue.events.length > 0 ? (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Events
            </h2>
            <ul className="space-y-2 text-sm text-gray-800">
              {venue.events.map((event) => (
                <li
                  key={event.id}
                  className="bg-white rounded-xl border border-gray-200 p-4"
                >
                  <div className="font-medium">{event.title}</div>
                  {event.nextOccurrenceLabel && (
                    <div className="text-gray-500 mt-0.5">
                      {event.nextOccurrenceLabel}
                    </div>
                  )}
                  {event.description && (
                    <div className="text-gray-600 mt-1 text-xs">
                      {event.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-gray-500">
            No events listed yet for this venue.
          </p>
        )}
      </div>
    </main>
  );
}
