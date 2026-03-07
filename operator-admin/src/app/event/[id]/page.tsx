import { notFound } from "next/navigation";
import Link from "next/link";
import { getEventForConsumerById } from "@/lib/data/events";
import { ConsumerNav } from "../../ConsumerNav";
import { BookmarkButton } from "../../BookmarkButton";

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
    <main className="min-h-screen bg-white pb-20">

      {/* Detail page header — matches original .detail-page-header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        <Link
          href="/events"
          className="text-blue-500 text-2xl font-bold leading-none mr-3"
          aria-label="Back to Events"
        >
          ←
        </Link>
        <h1 className="flex-1 text-lg font-bold text-gray-900">
          Event Details
        </h1>
        <BookmarkButton venueId={event.venueId} />
      </div>

      {isPreview && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 font-medium">
          Preview mode — this event may not be publicly visible yet.
        </div>
      )}

      {/* Hero image — matches original .venue-hero-image (240px) */}
      {event.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.imageUrl}
          alt={event.title}
          className="w-full object-cover bg-gray-200"
          style={{ height: "240px" }}
        />
      ) : (
        <div className="w-full bg-gray-200" style={{ height: "240px" }} />
      )}

      {/* Name section — matches original .venue-name-section */}
      <div className="bg-white px-5 pt-5 pb-3 border-b border-gray-100">
        {/* Event title — .venue-name-large */}
        <h2 className="text-2xl font-bold text-gray-900 leading-tight mb-2">
          {event.title}
        </h2>
        {/* Venue name — .event-venue-text (gray, medium weight) */}
        {event.venueName && (
          <p className="text-[15px] font-medium text-gray-500 mb-1.5">
            {event.venueName}
          </p>
        )}
        {/* Schedule meta — .venue-meta-row */}
        {event.nextOccurrenceLabel && (
          <p className="text-xs text-gray-400">
            {event.nextOccurrenceLabel}
          </p>
        )}
      </div>

      {/* Content sections — matches original .venue-sections structure */}
      <div className="bg-white">

        {/* Event section */}
        {(event.nextOccurrenceLabel || event.description) && (
          <div className="px-5 py-5 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Event</h3>
            <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
              {event.nextOccurrenceLabel && (
                <p>
                  <span className="font-semibold text-gray-900">Date &amp; Time</span>
                  <br />
                  {event.nextOccurrenceLabel}
                </p>
              )}
              {event.description && (
                <p>
                  <span className="font-semibold text-gray-900">Details</span>
                  <br />
                  {event.description}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Venue section — matches original #section-venue */}
        <div className="px-5 py-5">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Venue</h3>
          <p className="text-sm font-medium text-gray-900 mb-4">
            {event.venueName}
          </p>
          <Link
            href={`/venue/${event.venueId}`}
            className="inline-block px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
          >
            View venue →
          </Link>
        </div>

      </div>

      <ConsumerNav />
    </main>
  );
}
