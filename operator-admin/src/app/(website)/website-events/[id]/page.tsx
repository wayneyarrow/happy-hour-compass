import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getEventForWebsite } from "@/lib/data/events";
import { buildEventMetadata } from "@/lib/seo/metadata";
import { buildBreadcrumbListNode } from "@/lib/seo/schema/breadcrumb";
import { JsonLd } from "@/app/(website)/JsonLd";
import { getEventTypeLabel, getEventTypeEmoji } from "@/lib/eventTypes";
import { GoogleRatingBadge } from "@/app/(consumer)/venue/[id]/GoogleRatingBadge";
import { EventViewTracker } from "@/app/(consumer)/event/[id]/EventViewTracker";
import { VenueDetailMap } from "@/app/(website)/[market]/[city]/[slug]/VenueDetailMap";
import { StickyNav } from "@/app/(website)/[market]/[city]/[slug]/StickyNav";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { SaveEventButton } from "@/app/(website)/SaveEventButton";
import { EventActionCard } from "./EventActionCard";
import { EventMobileActionBar } from "./EventMobileActionBar";
import { MakeANightOfIt } from "./MakeANightOfIt";
import { KnowBeforeYouGo } from "./KnowBeforeYouGo";
import { BusinessHoursPanel } from "./BusinessHoursPanel";
import { formatPrice, buildDetailDateLabel } from "./eventFormatters";

// Always read fresh DB data — event status and sold-out state are time-sensitive.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const event = await getEventForWebsite(id);
  if (!event) return { title: "Event" };
  return buildEventMetadata({
    eventName: `${event.title} at ${event.venueName}`,
    description:
      event.description?.slice(0, 160) ||
      `${event.title} at ${event.venueName}. ${event.nextOccurrenceLabel}.`.trim(),
    eventId: id,
    ogImage: event.imageUrl ?? undefined,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const DAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-gray-900 mb-5 tracking-tight leading-snug">
      {children}
    </h2>
  );
}

function InfoRow({
  label,
  children,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="py-4 flex items-start gap-4">
      <span className="shrink-0 mt-0.5 text-gray-400 w-5 h-5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-gray-500 mb-1">
          {label}
        </p>
        <div className="text-sm font-medium text-gray-800">{children}</div>
      </div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 shrink-0 text-gray-300"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ─── Compact hero image ───────────────────────────────────────────────────────

function EventHeroImage({
  imageUrl,
  title,
}: {
  imageUrl: string | null;
  title: string;
}) {
  if (imageUrl) {
    return (
      <div className="relative h-[200px] lg:h-[260px] rounded-2xl overflow-hidden bg-gray-100 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={title}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className="relative h-[200px] lg:h-[260px] rounded-2xl overflow-hidden shadow-sm"
      style={{
        background:
          "linear-gradient(135deg, #78350f 0%, #92400e 40%, #b45309 70%, #d97706 100%)",
      }}
      role="img"
      aria-label={title}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(255,255,255,0.14) 0%, transparent 55%)",
        }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: "rgba(255,255,255,0.15)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.25)",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-7 h-7"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WebsiteEventDetailPage({ params }: PageProps) {
  const { id } = await params;

  const event = await getEventForWebsite(id);

  if (!event) notFound();

  // Home → Event Title only — deliberately not Home → Events → Title. The
  // visible page breadcrumb (below) does link "Events" to /website-events,
  // but that route is explicitly robots: { index: false } (see
  // (website)/website-events/page.tsx) and excluded from the sitemap — it
  // fails "appropriate for indexing" / "stable, crawlable, canonical
  // public page," so it cannot be a valid intermediate breadcrumb level
  // here even though it's a real, linkable route. Same canonical path
  // template buildEventMetadata() (metadata.ts) already builds for its
  // <link rel="canonical"> tag. Event structured data itself remains
  // deferred and is not reintroduced by this breadcrumb.
  const eventCanonicalPath = `/website-events/${id}`;
  const breadcrumbNode = buildBreadcrumbListNode({
    canonicalPath: eventCanonicalPath,
    items: [
      { name: "Home", path: "/" },
      { name: event.title, path: eventCanonicalPath },
    ],
  });

  // ── Derived values ─────────────────────────────────────────────────────────

  const heroImageUrl = event.imageUrl ?? event.venueImages[0]?.url ?? null;

  const mapsUrl = event.venueAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        event.venueAddress
      )}`
    : null;

  // Derived from the venue's own stored market/city relationship (not the
  // visitor's ambient active-market cookie) — see buildVenuePublicPath.
  const venueUrl = buildVenuePublicPath({
    marketSlug: event.venueMarketSlug,
    citySlug: event.venueCitySlug,
    slug: event.venueSlug,
  });

  const websiteUrl = event.venueWebsiteUrl || null;
  const menuUrl = event.venueMenuUrl || null;

  const typeLabel = getEventTypeLabel(event.eventType);
  const typeEmoji = getEventTypeEmoji(event.eventType);
  const showType = Boolean(typeLabel) && event.eventType !== "other";

  const hasBusinessHours = DAY_ORDER.some(
    (d) => event.venueHoursWeekly[d] && event.venueHoursWeekly[d] !== "CLOSED"
  );
  const hasDescription = Boolean(event.description?.trim());
  const hasOtherEvents = event.otherEvents.length > 0;
  const hasVenueAbout = Boolean(event.venueAbout?.trim());
  const hasVenueHh = Object.values(event.venueHhWeekly).some((s) => s.length > 0);

  const hasKnowBeforeYouGo = Boolean(
    event.priceDisplay ||
    event.ageRestriction ||
    event.reservationRecommendation ||
    event.parkingNotes ||
    event.accessibilityNotes ||
    (event.startTime && event.endTime)
  );

  const showGetTickets =
    !event.isExpired &&
    event.ticketingEnabled &&
    !event.soldOut &&
    Boolean(event.ticketUrl);
  const showSoldOut = event.ticketingEnabled && event.soldOut;

  // Detail-page date label — "Tuesday, Jun 30 • 8:00 PM" for one-off,
  // "Tuesdays • 8:00 PM" for recurring, etc.
  const detailDateLabel = buildDetailDateLabel(
    event.firstDate,
    event.recurrence,
    event.startTime,
    event.endTime
  );

  // Day-of-week of the event (derived from firstDate) — used to emphasise
  // the correct row in the business hours panel.
  const eventDayName: string | null = (() => {
    if (!event.firstDate) return null;
    const m = event.firstDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return DAY_ORDER[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  })();

  // Today's day name (UTC) — used to annotate the event day with "(Today)".
  const todayDayName = DAY_ORDER[new Date().getUTCDay()];

  // Header (72px) + sticky section nav (48px) + 12px buffer.
  const SCROLL_MARGIN = 132;

  const sections = [
    ...(hasDescription ? [{ id: "about", label: "About" }] : []),
    ...(hasVenueHh ? [{ id: "happy-hour", label: "Happy Hour" }] : []),
    ...(hasKnowBeforeYouGo ? [{ id: "know-before", label: "Know Before You Go" }] : []),
    { id: "when-where", label: "When & Where" },
    { id: "venue", label: "Venue" },
    ...(hasOtherEvents ? [{ id: "more-events", label: "More Events" }] : []),
  ];

  return (
    <div className="bg-white pb-20 lg:pb-0">
      <EventViewTracker eventId={event.id} />
      <JsonLd nodes={[breadcrumbNode]} />

      {/* ── Hero: event identity + compact image ──────────────────────────── */}
      <div className="border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">

          {/* Breadcrumb */}
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-sm text-gray-500 pt-5 pb-4 min-w-0"
          >
            <Link
              href="/"
              className="hover:text-gray-900 transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              Home
            </Link>
            <ChevronIcon />
            <Link
              href="/website-events"
              className="hover:text-gray-900 transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              Events
            </Link>
            <ChevronIcon />
            <span className="text-gray-900 font-medium truncate min-w-0">
              {event.title}
            </span>
          </nav>

          {/* Split grid — image right on desktop, above identity on mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-8 pb-8 lg:pb-10 items-start">

            {/* Image — above identity on mobile, right column on desktop */}
            <div className="order-first lg:order-last">
              <EventHeroImage imageUrl={heroImageUrl} title={event.title} />
            </div>

            {/* Event identity */}
            <div className="order-last lg:order-first flex flex-col gap-0 pt-0 lg:pt-2">

              {/* Expired banner */}
              {event.isExpired && (
                <div className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-xl bg-gray-50 border border-gray-200">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 mt-0.5 text-gray-400"
                    style={{ width: 18, height: 18 }}
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    This event has already taken place.
                    {hasOtherEvents && (
                      <> See other upcoming events at {event.venueName} below.</>
                    )}
                    {venueUrl && (
                      <>{" "}<Link href={venueUrl} className="font-medium text-amber-700 hover:text-amber-800 transition-colors underline underline-offset-2">
                        View happy hour at {event.venueName}
                      </Link></>
                    )}
                  </p>
                </div>
              )}

              {/* Category pill */}
              {showType && (
                <div className="mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-[11px] font-semibold text-gray-600 uppercase tracking-[0.7px]">
                    <span aria-hidden="true">{typeEmoji}</span>
                    {typeLabel}
                  </span>
                </div>
              )}

              {/* Title + save */}
              <div className="flex items-start gap-2 mb-3">
                <h1 className="flex-1 min-w-0 text-[1.75rem] md:text-[2rem] lg:text-[2.2rem] font-bold text-gray-900 leading-tight tracking-tight">
                  {event.title}
                </h1>
                <SaveEventButton eventId={event.id} variant="detail" />
              </div>

              {/* Venue link */}
              {event.venueName && (
                <div className="flex items-center gap-1.5 mb-4">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 text-gray-400 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M3 21h18" />
                    <path d="M5 21V7l7-4 7 4v14" />
                    <rect x="9" y="12" width="6" height="9" />
                  </svg>
                  {venueUrl ? (
                    <Link
                      href={venueUrl}
                      className="text-[15px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      {event.venueName}
                    </Link>
                  ) : (
                    <span className="text-[15px] font-semibold text-gray-700">
                      {event.venueName}
                    </span>
                  )}
                </div>
              )}

              {/* Schedule + price row */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                {detailDateLabel && (
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-sm font-semibold text-amber-800">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5 shrink-0"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    {detailDateLabel}
                    {event.isExpired && (
                      <span className="text-xs font-normal text-amber-600 ml-0.5">(Past)</span>
                    )}
                  </span>
                )}
                {event.priceDisplay && (
                  <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-gray-100 border border-gray-200 text-sm font-semibold text-gray-700">
                    {formatPrice(event.priceDisplay)}
                  </span>
                )}
              </div>

              {/* Ticket CTA */}
              {showGetTickets && (
                <div>
                  <a
                    href={event.ticketUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold text-sm transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
                      <path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 0 0-2 2v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5z" />
                    </svg>
                    Get Tickets
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              )}

              {/* Sold out */}
              {showSoldOut && (
                <div className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-gray-100 text-gray-400 font-semibold text-sm cursor-not-allowed select-none">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
                    <path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 0 0-2 2v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5z" />
                  </svg>
                  Sold Out
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Page body ─────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">

        <StickyNav sections={sections} />

        {/* Two-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-10 xl:gap-16 pt-10">

          {/* ── Left: main content ──────────────────────────────────────── */}
          <div className="min-w-0 space-y-14">

            {/* 1. About This Event */}
            {hasDescription && (
              <section id="about" style={{ scrollMarginTop: SCROLL_MARGIN }}>
                <SectionHeading>About This Event</SectionHeading>
                <p className="text-[15px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {event.description}
                </p>
              </section>
            )}

            {/* 2. Make a Night of It */}
            {hasVenueHh && (
              <section id="happy-hour" style={{ scrollMarginTop: SCROLL_MARGIN }}>
                <SectionHeading>Make a Night of It</SectionHeading>
                <MakeANightOfIt
                  venueName={event.venueName}
                  venueUrl={venueUrl}
                  venueHhTagline={event.venueHhTagline}
                  venueHhWeekly={event.venueHhWeekly}
                  venueSpecialsFoodCount={event.venueSpecialsFoodCount}
                  venueSpecialsDrinksCount={event.venueSpecialsDrinksCount}
                  firstDate={event.firstDate}
                  startTime={event.startTime}
                  endTime={event.endTime}
                />
              </section>
            )}

            {/* 3. Know Before You Go */}
            {hasKnowBeforeYouGo && (
              <section id="know-before" style={{ scrollMarginTop: SCROLL_MARGIN }}>
                <SectionHeading>Know Before You Go</SectionHeading>
                <KnowBeforeYouGo
                  priceDisplay={event.priceDisplay}
                  ageRestriction={event.ageRestriction}
                  reservationRecommendation={event.reservationRecommendation}
                  parkingNotes={event.parkingNotes}
                  accessibilityNotes={event.accessibilityNotes}
                  startTime={event.startTime}
                  endTime={event.endTime}
                />
              </section>
            )}

            {/* 4. When & Where */}
            <section id="when-where" style={{ scrollMarginTop: SCROLL_MARGIN }}>
              <SectionHeading>When & Where</SectionHeading>

              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-6 lg:gap-8 items-start">

                {/* Left: info rows */}
                <div>
                  <div className="divide-y divide-gray-100">
                    {detailDateLabel && (
                      <InfoRow
                        label="Schedule"
                        icon={
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                        }
                      >
                        <span className="text-gray-900">{detailDateLabel}</span>
                        {event.isExpired && (
                          <span className="ml-2 text-xs font-medium text-gray-400">(Past event)</span>
                        )}
                      </InfoRow>
                    )}

                    {event.venueAddress && (
                      <InfoRow
                        label="Address"
                        icon={
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                        }
                      >
                        {mapsUrl ? (
                          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">
                            {event.venueAddress}
                          </a>
                        ) : (
                          event.venueAddress
                        )}
                        {event.venueName && (
                          <p className="text-xs font-normal text-gray-500 mt-0.5">{event.venueName}</p>
                        )}
                      </InfoRow>
                    )}

                    {event.venuePhone && (
                      <InfoRow
                        label="Phone"
                        icon={
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 8 19.79 19.79 0 0 1 1.04 4.11a2 2 0 0 1 1.72-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                        }
                      >
                        <a href={`tel:${event.venuePhone}`} className="hover:text-blue-600 transition-colors">
                          {formatPhone(event.venuePhone)}
                        </a>
                      </InfoRow>
                    )}

                    {websiteUrl && (
                      <InfoRow
                        label="Website"
                        icon={
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="2" y1="12" x2="22" y2="12" />
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                          </svg>
                        }
                      >
                        <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 transition-colors break-all">
                          {websiteUrl.replace(/^https?:\/\//, "")}
                        </a>
                      </InfoRow>
                    )}

                    {menuUrl && (
                      <InfoRow
                        label="Menu"
                        icon={
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                            <rect x="9" y="3" width="6" height="4" rx="1" ry="1" />
                            <line x1="9" y1="12" x2="15" y2="12" />
                            <line x1="9" y1="16" x2="12" y2="16" />
                          </svg>
                        }
                      >
                        <a href={menuUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 transition-colors">
                          View menu
                        </a>
                      </InfoRow>
                    )}

                    {/* Business hours — event day summary + expand/collapse */}
                    {hasBusinessHours && (
                      <InfoRow
                        label="Hours"
                        icon={
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        }
                      >
                        <BusinessHoursPanel
                          hoursWeekly={event.venueHoursWeekly}
                          eventDayName={eventDayName}
                          todayDayName={todayDayName}
                        />
                      </InfoRow>
                    )}
                  </div>
                </div>

                {/* Right: compact map */}
                <div className="md:self-start">
                  <VenueDetailMap
                    lat={event.venueLat}
                    lng={event.venueLng}
                    venueName={event.venueName}
                    mapsUrl={mapsUrl}
                  />
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      Open in Google Maps
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden="true">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            </section>

            {/* 5. About the Venue */}
            <section id="venue" style={{ scrollMarginTop: SCROLL_MARGIN }}>
              <SectionHeading>About {event.venueName}</SectionHeading>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/40 p-6">
                <div className="mb-4">
                  {venueUrl ? (
                    <Link href={venueUrl} className="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors leading-snug">
                      {event.venueName}
                    </Link>
                  ) : (
                    <p className="text-lg font-bold text-gray-900 leading-snug">{event.venueName}</p>
                  )}
                  {event.venueEstablishmentType && (
                    <p className="text-sm text-gray-500 mt-0.5">{event.venueEstablishmentType}</p>
                  )}
                  {event.venueGoogleRating !== null && (
                    <div className="mt-2">
                      <GoogleRatingBadge
                        googleRating={event.venueGoogleRating}
                        googleReviewCount={event.venueGoogleReviewCount}
                      />
                    </div>
                  )}
                </div>

                {hasVenueAbout && (
                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-4 mb-4">
                    {event.venueAbout}
                  </p>
                )}

                {venueUrl && (
                  <Link
                    href={venueUrl}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 hover:text-amber-800 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    View Venue Page
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                )}
              </div>
            </section>

            {/* 6. More Events at This Venue */}
            {hasOtherEvents && (
              <section id="more-events" style={{ scrollMarginTop: SCROLL_MARGIN }}>
                <SectionHeading>More Events at {event.venueName}</SectionHeading>
                <div className="space-y-3">
                  {event.otherEvents.map((other) => {
                    const otherTypeLabel = getEventTypeLabel(other.eventType);
                    const otherTypeEmoji = getEventTypeEmoji(other.eventType);
                    const showOtherType = Boolean(otherTypeLabel) && other.eventType !== "other";
                    return (
                      <Link
                        key={other.id}
                        href={`/website-events/${other.id}`}
                        className="flex items-start gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50/60 hover:bg-white hover:border-gray-200 hover:shadow-sm transition-all group"
                      >
                        <div className="shrink-0 w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                          <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-[15px] leading-snug group-hover:text-gray-700 transition-colors">
                            {other.title}
                          </p>
                          {other.nextOccurrenceLabel && (
                            <p className="text-sm text-amber-700 font-medium mt-0.5">
                              {other.nextOccurrenceLabel}
                            </p>
                          )}
                          {showOtherType && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              <span aria-hidden="true">{otherTypeEmoji}</span>{" "}{otherTypeLabel}
                            </p>
                          )}
                        </div>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-gray-300 shrink-0 mt-1 group-hover:text-gray-400 transition-colors" aria-hidden="true">
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="h-4" aria-hidden="true" />
          </div>

          {/* ── Right: sticky action card (desktop only) ─────────────────── */}
          <div className="hidden lg:block">
            <div className="sticky top-36">
              <EventActionCard
                detailDateLabel={detailDateLabel}
                priceDisplay={event.priceDisplay}
                venueName={event.venueName}
                venueUrl={venueUrl}
                mapsUrl={mapsUrl}
                websiteUrl={websiteUrl}
                phone={event.venuePhone}
                ticketingEnabled={event.ticketingEnabled}
                ticketUrl={event.ticketUrl}
                soldOut={event.soldOut}
                isExpired={event.isExpired}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom action bar */}
      <EventMobileActionBar
        mapsUrl={mapsUrl}
        websiteUrl={websiteUrl}
        phone={event.venuePhone}
        ticketingEnabled={event.ticketingEnabled}
        ticketUrl={event.ticketUrl}
        soldOut={event.soldOut}
        isExpired={event.isExpired}
      />
    </div>
  );
}
