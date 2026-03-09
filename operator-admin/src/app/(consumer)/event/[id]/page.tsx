import { notFound } from "next/navigation";
import Link from "next/link";
import { getEventForConsumerById } from "@/lib/data/events";
import { EventBookmarkButton } from "../../EventBookmarkButton";
import { ShareButton } from "./ShareButton";

// Never serve a stale version — preview mode must always read live DB data.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const DAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

/** Formats a 10-digit phone string as "(XXX) XXX-XXXX"; returns raw if not 10 digits. */
function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

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

  // Days with non-CLOSED hours, in canonical Sun→Sat order.
  const openDays = DAY_ORDER.filter(
    (d) => event.venueHoursWeekly[d] && event.venueHoursWeekly[d] !== "CLOSED"
  );

  // URL-encode address for Google Maps.
  const mapsUrl = event.venueAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venueAddress)}`
    : null;

  // Menu URL: prefer dedicated menu URL, fall back to website.
  const menuTarget = event.venueMenuUrl || event.venueWebsiteUrl;

  return (
    <main className="bg-white">

      {/* ── Header ─────────────────────────────────────────────────────────────
          Matches original .detail-page-header:
          padding: 16px 20px, border-bottom: 1px solid #e5e7eb, flex, space-between */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        {/* Back button — .detail-back-btn: blue-500, 24px bold */}
        <Link
          href="/events"
          className="text-blue-500 text-2xl font-bold leading-none shrink-0"
          aria-label="Back to Events"
        >
          ←
        </Link>
        {/* Title — .detail-page-title: 18px bold gray-900, flex-1, ml-3 (12px) */}
        <h1 className="flex-1 text-[18px] font-bold text-gray-900 ml-3 truncate">
          {event.title}
        </h1>
        {/* Header actions — .header-actions: flex gap-3, bookmark + share */}
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <EventBookmarkButton eventId={event.id} variant="header" />
          <ShareButton />
        </div>
      </div>

      {isPreview && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 font-medium">
          Preview mode — this event may not be publicly visible yet.
        </div>
      )}

      {/* ── Hero image ─────────────────────────────────────────────────────────
          Matches original .venue-hero-image: 240px, bg-size cover, bg-color #e5e7eb.
          Fallback: gradient + "Photo not available" (.venue-hero-image.fallback) */}
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

      {/* ── Name section ───────────────────────────────────────────────────────
          Matches original .venue-name-section: padding: 20px 20px 12px */}
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

      {/* ── Action buttons ─────────────────────────────────────────────────────
          Matches original .venue-action-buttons: padding 0 20px 20px, flex gap-2.
          Each .venue-action-btn: flex-1, white bg, border gray-300, rounded-lg,
          padding 12px 8px, min-height 64px, 13px medium #374151, column layout gap-6px */}
      {(event.venuePhone || event.venueWebsiteUrl) && (
        <div className="flex gap-2 px-5 pb-5">
          {event.venuePhone && (
            <a
              href={`tel:${event.venuePhone}`}
              className="flex-1 flex flex-col items-center justify-center gap-1.5 bg-white border border-gray-300 rounded-lg text-[13px] font-medium text-[#374151] hover:bg-gray-50 hover:border-gray-400 transition-colors"
              style={{ padding: "12px 8px", minHeight: 64 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>Call</span>
            </a>
          )}
          {event.venueWebsiteUrl && (
            <a
              href={event.venueWebsiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex flex-col items-center justify-center gap-1.5 bg-white border border-gray-300 rounded-lg text-[13px] font-medium text-[#374151] hover:bg-gray-50 hover:border-gray-400 transition-colors"
              style={{ padding: "12px 8px", minHeight: 64 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>Website</span>
            </a>
          )}
        </div>
      )}

      {/* ── Jump chips nav ─────────────────────────────────────────────────────
          Matches original .venue-section-nav.venue-tabs:
          sticky top (below header), bg-white, padding 12px 16px, border-bottom.
          Chips: .section-nav-item — flex-1, border 1.5px gray-300, rounded-[20px],
          px-5 py-2.5, 14px medium gray-500; hover: border-gray-400 bg-gray-50 */}
      <div className="sticky top-[61px] z-[9] bg-white px-4 py-3 border-b border-gray-200">
        {/* "Jump to" — .venue-nav-label: 12px semibold uppercase tracking-[0.5px] gray-500 */}
        <p className="text-[12px] font-semibold uppercase tracking-[0.5px] text-gray-500 mb-2">
          Jump to
        </p>
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

      {/* ── Content sections ───────────────────────────────────────────────────
          Matches original .venue-sections: bg white, padding-bottom 100px */}
      <div className="bg-white pb-24">

        {/* ── Event section ──────────────────────────────────────────────────
            Matches original #section-event .venue-section: padding 20px, min-height 300px.
            scroll-margin-top ensures the section scrolls past both sticky bars. */}
        <div
          id="section-event"
          className="px-5 py-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          {/* .section-title: 18px bold gray-900, margin-bottom 16px */}
          <h3 className="text-[18px] font-bold text-gray-900 mb-4">Event</h3>

          {/* Info box — matches original .info-box:
              background: #dbeafe, border-radius 8px, padding 16px,
              margin-bottom 20px, font-size 14px, color #111827, line-height 1.5 */}
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

        {/* ── Venue section ──────────────────────────────────────────────────
            Matches original #section-venue .venue-section.
            Shows venue info rows matching original renderEventVenueInfo(). */}
        <div
          id="section-venue"
          className="px-5 py-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          <h3 className="text-[18px] font-bold text-gray-900 mb-4">Venue</h3>

          {/* Info rows — matches original .venue-info-details:
              flat list with dividers, .info-list-row / .info-list-row-action */}
          <div className="flex flex-col">

            {/* Business Hours row — shows non-CLOSED days */}
            {openDays.length > 0 && (
              <div className="flex items-start justify-between py-4 border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  {/* .info-row-label: 11px semibold gray-500 uppercase tracking-[0.8px] */}
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Business Hours
                  </p>
                  <div className="text-[15px] text-gray-900 leading-[1.5] space-y-0.5">
                    {openDays.map((day) => (
                      <div key={day} className="flex justify-between gap-4">
                        <span className="text-gray-500 text-sm w-24 shrink-0">{day}</span>
                        <span className="text-sm">{event.venueHoursWeekly[day]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Address row — tappable, opens Google Maps */}
            {event.venueAddress && (
              <a
                href={mapsUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between py-[18px] min-h-[60px] border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors -mx-5 px-5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Address
                  </p>
                  {/* .info-row-value: 15px gray-900, line-height 1.5, 2-line clamp */}
                  <p className="text-[15px] text-gray-900 leading-[1.5] line-clamp-2 break-words">
                    {event.venueAddress}
                  </p>
                </div>
                <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
              </a>
            )}

            {/* Menu row — tappable, opens menu/website URL */}
            {menuTarget && (
              <a
                href={menuTarget}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between py-[18px] min-h-[60px] border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors -mx-5 px-5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Menu
                  </p>
                  <p className="text-[15px] text-gray-900 leading-[1.5]">View menu</p>
                </div>
                <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </div>
              </a>
            )}

            {/* Phone row — tappable, click-to-call */}
            {event.venuePhone && (
              <a
                href={`tel:${event.venuePhone}`}
                className="flex items-start justify-between py-[18px] min-h-[60px] border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors -mx-5 px-5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Phone
                  </p>
                  <p className="text-[15px] text-gray-900 leading-[1.5]">
                    {formatPhone(event.venuePhone)}
                  </p>
                </div>
                <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
              </a>
            )}

            {/* Payment row — static display */}
            {event.venuePaymentMethods && (
              <div className="flex items-start justify-between py-4 border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Payment
                  </p>
                  <p className="text-[15px] text-gray-900 leading-[1.5] break-words">
                    {event.venuePaymentMethods}
                  </p>
                </div>
              </div>
            )}

            {/* Website row — tappable, opens externally */}
            {event.venueWebsiteUrl && (
              <a
                href={event.venueWebsiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between py-[18px] min-h-[60px] border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors -mx-5 px-5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Website
                  </p>
                  <p className="text-[15px] text-gray-900 leading-[1.5] truncate">
                    {event.venueWebsiteUrl.replace(/^https?:\/\//, "")}
                  </p>
                </div>
                <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </div>
              </a>
            )}

            {/* View venue link — not in original but useful navigation in a multi-page app */}
            <div className="pt-5">
              <Link
                href={`/venue/${event.venueId}`}
                className="inline-block px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
              >
                View full venue →
              </Link>
            </div>

          </div>
        </div>

      </div>

    </main>
  );
}
