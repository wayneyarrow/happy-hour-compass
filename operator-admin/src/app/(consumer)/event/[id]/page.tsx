import { notFound } from "next/navigation";
import { getEventForConsumerById } from "@/lib/data/events";
import { EventBookmarkButton } from "../../EventBookmarkButton";
import { ShareButton } from "./ShareButton";
import { JumpChips } from "./JumpChips";
import { BusinessHoursRow } from "./BusinessHoursRow";
import { EventBackButton } from "./EventBackButton";
import { EventViewTracker } from "./EventViewTracker";
import { EventActionButtons } from "./EventActionButtons";
import { VenueInfoRows } from "../../venue/[id]/VenueInfoRows";

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
      <EventViewTracker eventId={event.id} />

      {/* ── Header ─────────────────────────────────────────────────────────────
          Matches original .detail-page-header:
          padding: 16px 20px, border-bottom: 1px solid #e5e7eb, flex, space-between */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        {/* Back button — router.back() so collection context is preserved */}
        <EventBackButton />
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
          Real image if available; premium amber gradient fallback otherwise. */}
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
          className="w-full flex flex-col items-center justify-center gap-3"
          style={{
            height: 240,
            background: "linear-gradient(140deg, #78350f 0%, #92400e 50%, #b45309 100%)",
            position: "relative",
          }}
        >
          {/* Radial highlight */}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at top right, rgba(255,255,255,0.15) 0%, transparent 60%)", pointerEvents: "none" }} />
          <div style={{
            width: 60,
            height: 60,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.18)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.28)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 30,
          }}>
            🎉
          </div>
          <span style={{ color: "rgba(255,255,255,0.80)", fontSize: 13, fontWeight: 600, letterSpacing: "0.3px" }}>
            {event.title}
          </span>
        </div>
      )}

      {/* ── Name section ─────────────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4">
        {/* Event title */}
        <h2 className="text-[26px] font-bold text-gray-900 leading-[1.2] mb-2 break-words tracking-tight">
          {event.title}
        </h2>
        {/* Venue — clickable link to venue page */}
        {event.venueName && (
          <p className="text-[15px] font-semibold text-blue-600 mb-1.5">
            {event.venueName}
          </p>
        )}
        {/* Date/time pill */}
        {event.nextOccurrenceLabel && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {event.nextOccurrenceLabel}
          </span>
        )}
      </div>

      {/* ── Action buttons ─────────────────────────────────────────────────────
          Extracted to EventActionButtons (client component) for click tracking. */}
      <EventActionButtons
        venueId={event.venueId}
        venuePhone={event.venuePhone}
        venueWebsiteUrl={event.venueWebsiteUrl}
      />

      {/* ── Jump chips nav ─────────────────────────────────────────────────────
          Matches original .venue-section-nav.venue-tabs:
          sticky top (below header), bg-white, padding 12px 16px, border-bottom.
          Active chip fills blue — handled by the JumpChips client component. */}
      <div className="sticky top-[61px] z-[9] bg-white px-4 py-3 border-b border-gray-200">
        {/* "Jump to" — .venue-nav-label: 12px semibold uppercase tracking-[0.5px] gray-500 */}
        <p className="text-[12px] font-semibold uppercase tracking-[0.5px] text-gray-500 mb-2">
          Jump to
        </p>
        <JumpChips />
      </div>

      {/* ── Content sections ───────────────────────────────────────────────────
          Matches original .venue-sections: bg white, padding-bottom 100px */}
      <div className="bg-white pb-24">

        {/* ── Event section ──────────────────────────────────────────────────
            Matches original #section-event .venue-section: padding 20px, min-height 300px.
            scroll-margin-top ensures the section scrolls past both sticky bars. */}
        <div
          id="section-event"
          className="px-5 pt-6 pb-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          {/*
            Scroll anchor — mirrors the original app's .scroll-anchor pattern.
            position:relative + negative top pulls the anchor element above the
            section heading so that:
              • clicking a chip scrolls to (anchor_absPos − 10), landing the
                section heading just below the sticky bars (same as original's
                scrollTo(anchor.offsetTop − 10))
              • the scroll handler fires at (scrollY + 100 >= anchor_absPos),
                which triggers at the same relative position as the original's
                scrollTop + 100 >= anchor.offsetTop rule.
            The −196 px offset bakes in our total sticky height (141 px) plus
            the original's 56 px container-start buffer so click landing and
            trigger timing match the original's visual behavior exactly.
          */}
          {/* eslint-disable-next-line jsx-a11y/aria-hidden-on-focusable */}
          <div
            id="anchor-event"
            aria-hidden="true"
            style={{ position: "relative", top: -196, height: 1 }}
          />
          <h3 className="text-[19px] font-bold text-gray-900 mb-4 tracking-tight">Event</h3>

          {/* Event info card */}
          <div
            className="rounded-2xl p-4 mb-5 text-[14px] text-gray-900 leading-relaxed"
            style={{
              background: "linear-gradient(160deg, #fef3c7 0%, #fffbf5 100%)",
              border: "1px solid #fde68a",
              boxShadow: "0 2px 8px rgba(180,83,9,0.06)",
            }}
          >
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

        {/* Section divider */}
        <div className="mx-5 border-t border-gray-100" />

        {/* ── Venue section ──────────────────────────────────────────────────
            Matches original #section-venue .venue-section.
            Shows venue info rows matching original renderEventVenueInfo(). */}
        <div
          id="section-venue"
          className="px-5 pt-6 pb-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          {/* Scroll anchor — same pattern as #anchor-event above */}
          {/* eslint-disable-next-line jsx-a11y/aria-hidden-on-focusable */}
          <div
            id="anchor-venue"
            aria-hidden="true"
            style={{ position: "relative", top: -196, height: 1 }}
          />
          <h3 className="text-[19px] font-bold text-gray-900 mb-4 tracking-tight">Venue</h3>

          {/* Info rows — matches original .venue-info-details:
              flat list with dividers, .info-list-row / .info-list-row-action */}
          <div className="flex flex-col">

            {/* Business Hours row — Open now / Closed status + expandable weekly schedule */}
            {openDays.length > 0 && (
              <BusinessHoursRow
                hoursWeekly={event.venueHoursWeekly}
                venueId={event.venueId}
              />
            )}

            {/* Venue info rows — address, menu, phone, payment, website with click tracking */}
            <VenueInfoRows
              venueId={event.venueId}
              city=""
              address={event.venueAddress}
              mapsUrl={mapsUrl}
              menuTarget={menuTarget}
              phone={event.venuePhone}
              websiteUrl={event.venueWebsiteUrl}
              paymentMethods={event.venuePaymentMethods}
            />

          </div>
        </div>

      </div>

    </main>
  );
}
