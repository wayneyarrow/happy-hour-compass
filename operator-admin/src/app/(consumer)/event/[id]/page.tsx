import { notFound } from "next/navigation";
import Link from "next/link";
import { getEventForConsumerById } from "@/lib/data/events";
import { EventBookmarkButton } from "../../EventBookmarkButton";

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
    <main className="bg-white">

      {/* Detail page header — matches original .detail-page-header:
          background: white; padding: 16px 20px; border-bottom: 1px solid #e5e7eb;
          display: flex; justify-content: space-between; align-items: center */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        {/* Back button — .detail-back-btn: color #3b82f6, font-size 24px, font-weight bold */}
        <Link
          href="/events"
          className="text-blue-500 text-2xl font-bold leading-none"
          aria-label="Back to Events"
        >
          ←
        </Link>
        {/* Title — .detail-page-title: 18px bold gray-900, flex: 1, margin-left: 12px */}
        <h1 className="flex-1 text-[18px] font-bold text-gray-900 ml-3">
          Event Details
        </h1>
        {/* Bookmark — .header-icon-btn.header-bookmark-btn: 44px min tap target, 22px SVG,
            gray-500 default stroke, hover:bg-gray-100 */}
        <EventBookmarkButton eventId={event.id} variant="header" />
      </div>

      {isPreview && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 font-medium">
          Preview mode — this event may not be publicly visible yet.
        </div>
      )}

      {/* Hero image — matches original .venue-hero-image: 240px height, bg-size cover,
          bg-position center, bg-color #e5e7eb.
          Fallback: gradient + "Photo not available" text (matches .venue-hero-image.fallback) */}
      {event.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.imageUrl}
          alt={event.title}
          className="w-full object-cover object-center"
          style={{ height: 240, backgroundColor: "#e5e7eb" }}
        />
      ) : (
        <div
          className="w-full flex items-center justify-center"
          style={{
            height: 240,
            background: "linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)",
          }}
        >
          <span className="text-[14px] font-medium text-gray-400">
            Photo not available
          </span>
        </div>
      )}

      {/* Name section — matches original .venue-name-section: padding: 20px 20px 12px */}
      <div className="px-5 pt-5 pb-3">
        {/* Event title — .venue-name-large: 24px bold gray-900, mb: 8px, line-height 1.2 */}
        <h2 className="text-2xl font-bold text-gray-900 leading-[1.2] mb-2 break-words">
          {event.title}
        </h2>
        {/* Venue — .event-venue-text: 15px medium gray-500, mb: 6px */}
        {event.venueName && (
          <p className="text-[15px] font-medium text-gray-500 mb-1.5">
            {event.venueName}
          </p>
        )}
        {/* Date/time — .venue-meta-row: 12px, flex wrap */}
        {event.nextOccurrenceLabel && (
          <p className="text-xs text-gray-500 flex flex-wrap gap-1">
            {event.nextOccurrenceLabel}
          </p>
        )}
      </div>

      {/* Jump chips nav — matches original .venue-section-nav.venue-tabs:
          sticky, padding: 12px 16px, border-bottom: 1px solid #e5e7eb, z-index: 10 */}
      <div className="sticky top-[61px] z-[9] bg-white px-4 py-3 border-b border-gray-200">
        {/* "Jump to" label — .venue-nav-label: 12px semibold uppercase tracking-[0.5px] gray-500 */}
        <p className="text-[12px] font-semibold uppercase tracking-[0.5px] text-gray-500 mb-2">
          Jump to
        </p>
        {/* Chips — .section-nav-item: flex-1, border 1.5px gray-300, rounded-[20px],
            px-5 py-2.5, 14px medium gray-500; hover: border-gray-400 bg-gray-50 */}
        <div className="flex gap-2">
          {(["Event", "Venue"] as const).map((label) => (
            <a
              key={label}
              href={`#section-${label.toLowerCase()}`}
              className="flex-1 text-center border-[1.5px] border-gray-300 rounded-[20px] px-5 py-2.5 text-sm font-medium text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-all"
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      {/* Content sections — matches original .venue-sections: bg white, pb-100px */}
      <div className="bg-white pb-24">

        {/* Event section — matches original #section-event .venue-section:
            padding: 20px, min-height: 300px */}
        <div id="section-event" className="px-5 py-5 min-h-[300px]">
          {/* Section title — .section-title: 18px bold gray-900, mb: 16px */}
          <h3 className="text-[18px] font-bold text-gray-900 mb-4">Event</h3>
          {/* Info box — matches original .info-box:
              background: #dbeafe, border-radius: 8px, padding: 16px,
              margin-bottom: 20px, font-size: 14px, color: #111827, line-height: 1.5 */}
          <div className="bg-blue-100 rounded-lg p-4 mb-5 text-[14px] text-gray-900 leading-relaxed">
            {event.nextOccurrenceLabel && (
              <>
                <strong>Date &amp; Time</strong>
                <br />
                {event.nextOccurrenceLabel}
                {event.description && (
                  <>
                    <br />
                    <br />
                  </>
                )}
              </>
            )}
            {event.description ? (
              <>
                <strong>Event Details</strong>
                <br />
                {event.description}
              </>
            ) : (
              !event.nextOccurrenceLabel && (
                <>
                  <strong>Event Details</strong>
                  <br />
                  Event details will appear here.
                </>
              )
            )}
          </div>
        </div>

        {/* Venue section — matches original #section-venue .venue-section */}
        <div id="section-venue" className="px-5 py-5 min-h-[300px]">
          <h3 className="text-[18px] font-bold text-gray-900 mb-4">Venue</h3>
          {event.venueName && (
            <p className="text-sm font-medium text-gray-900 mb-4">
              {event.venueName}
            </p>
          )}
          <Link
            href={`/venue/${event.venueId}`}
            className="inline-block px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
          >
            View venue →
          </Link>
        </div>

      </div>

    </main>
  );
}
