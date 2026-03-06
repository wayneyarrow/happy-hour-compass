import { notFound } from "next/navigation";
import Link from "next/link";
import { getEventForConsumerById } from "@/lib/data/events";

// Never serve a stale version — preview mode must always read live DB data.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function EventPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  const isPreview =
    resolvedSearchParams.preview === "true" ||
    (Array.isArray(resolvedSearchParams.preview) &&
      resolvedSearchParams.preview.includes("true"));

  const event = await getEventForConsumerById(id, {
    includeUnpublished: isPreview,
  });

  if (!event) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero image */}
      {event.imageUrl && (
        <div className="w-full bg-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.imageUrl}
            alt={event.title}
            className="w-full object-cover"
            style={{ maxHeight: "320px" }}
          />
        </div>
      )}

      <div className="max-w-md mx-auto py-6 px-4">
        {isPreview && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
            Preview mode — this event may not be publicly visible yet.
          </div>
        )}

        <Link
          href={`/venue/${event.venueId}`}
          className="text-sm text-amber-700 hover:underline mb-4 block"
        >
          ← {event.venueName}
        </Link>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {event.title}
        </h1>

        {event.nextOccurrenceLabel && (
          <p className="text-sm text-gray-500 mb-6">{event.nextOccurrenceLabel}</p>
        )}

        {event.description && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-800 leading-relaxed">
              {event.description}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
