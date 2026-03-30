import { notFound } from "next/navigation";
import Link from "next/link";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";
import { BookmarkButton } from "../../BookmarkButton";
import { ShareButton } from "../../event/[id]/ShareButton";
import { VenueJumpChips } from "./VenueJumpChips";
import { VenueDetailMeta } from "./VenueDetailMeta";
import { HappyHourTimesCard } from "./HappyHourTimesCard";
import { BusinessHoursRow } from "../../event/[id]/BusinessHoursRow";
import { BackButton } from "./BackButton";

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

/**
 * Maps establishment type to a type-based placeholder image path.
 * Mirrors getVenueImage() from the original index.html.
 */
function getVenueImageSrc(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery")) return "/images/casual-dining-1.jpg";
  if (t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

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

  // Hero image: use first venue image if available, otherwise type-based fallback.
  const heroImageSrc = venue.images[0]?.url ?? getVenueImageSrc(venue.establishmentType);

  // Days with at least one business hours entry, Sun→Sat order.
  const openDays = DAY_ORDER.filter(
    (d) => venue.hoursWeekly[d] && venue.hoursWeekly[d] !== "CLOSED"
  );

  // Menu URL: prefer dedicated menu URL, fall back to website.
  const menuTarget = venue.menuUrl || venue.websiteUrl;

  // Google Maps URL for address.
  const mapsUrl = venue.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`
    : null;

  return (
    <main className="bg-white">

      {/* ── Header ─────────────────────────────────────────────────────────────
          Matches original .detail-page-header:
          padding: 16px 20px, border-bottom: 1px solid #e5e7eb, flex, space-between */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        {/* Back button — .detail-back-btn: blue-500, 24px bold */}
        <BackButton />
        {/* Title — .detail-page-title: 18px bold gray-900, flex-1, ml-3 (12px) */}
        <h1 className="flex-1 text-[18px] font-bold text-gray-900 ml-3 truncate">
          {venue.name}
        </h1>
        {/* Header actions — bookmark + share */}
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <BookmarkButton venueId={id} />
          <ShareButton />
        </div>
      </div>

      {isPreview && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 font-medium">
          Preview mode — this venue may not be publicly visible yet.
        </div>
      )}

      {/* ── Hero image ─────────────────────────────────────────────────────────
          Matches original .venue-hero-image: 240px height, object-cover */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={heroImageSrc}
        alt={venue.name}
        className="w-full object-cover object-center"
        style={{ height: 240, backgroundColor: "#e5e7eb" }}
      />

      {/* ── Name section ───────────────────────────────────────────────────────
          Matches original .venue-name-section: padding: 20px 20px 12px */}
      <div className="px-5 pt-5 pb-3">
        {/* Venue name — .venue-name-large: 24px bold gray-900, line-height 1.2 */}
        <h2
          className="text-2xl font-bold text-[#111827] leading-[1.2] break-words"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {venue.name}
        </h2>

        {/* Meta row — .venue-meta-row: status badge + distance + category tag */}
        <VenueDetailMeta
          hoursWeekly={venue.hoursWeekly}
          lat={venue.latitude}
          lng={venue.longitude}
          establishmentType={venue.establishmentType}
        />
      </div>

      {/* ── Action buttons ─────────────────────────────────────────────────────
          Matches original .venue-action-buttons: padding 0 20px 20px, flex gap-2.
          Each .venue-action-btn: flex-1, white bg, border gray-300, rounded-lg (8px),
          padding 12px 8px, min-height 64px, 13px medium #374151, column layout gap-6px.
          Only Call + Website per spec (Reserve excluded). */}
      {(venue.phone || venue.websiteUrl) && (
        <div className="flex gap-2 px-5 pb-5">
          {venue.phone && (
            <a
              href={`tel:${venue.phone}`}
              className="flex-1 flex flex-col items-center justify-center gap-1.5 bg-white border border-gray-300 rounded-lg text-[13px] font-medium text-[#374151] hover:bg-gray-50 hover:border-gray-400 transition-colors"
              style={{ padding: "12px 8px", minHeight: 64 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>Call</span>
            </a>
          )}
          {venue.websiteUrl && (
            <a
              href={venue.websiteUrl}
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
          sticky just below header, bg-white, padding 12px 16px, border-bottom.
          Active chip fills blue — handled by VenueJumpChips client component. */}
      <div className="sticky top-[61px] z-[9] bg-white px-4 py-3 border-b border-gray-200">
        {/* "Jump to" — .venue-nav-label: 12px semibold uppercase tracking gray-500 */}
        <p className="text-[12px] font-semibold uppercase tracking-[0.5px] text-gray-500 mb-2">
          Jump to
        </p>
        <VenueJumpChips />
      </div>

      {/* ── Content sections ───────────────────────────────────────────────────
          Matches original .venue-sections: bg white, padding-bottom 100px */}
      <div className="bg-white pb-24">

        {/* ── Happy Hour section ─────────────────────────────────────────────
            Matches original #section-happyhour .venue-section: padding 20px, min-height 300px.
            scroll-margin-top ensures the section scrolls past both sticky bars.
            Scroll anchor uses top: -196 — same calculation as event detail page
            (total sticky height 141px + original 56px container-start buffer = 197px ≈ 196px). */}
        <div
          id="section-happyhour"
          className="px-5 py-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          {/* eslint-disable-next-line jsx-a11y/aria-hidden-on-focusable */}
          <div
            id="anchor-happyhour"
            aria-hidden="true"
            style={{ position: "relative", top: -196, height: 1 }}
          />
          {/* .section-title: 18px bold gray-900, margin-bottom 16px */}
          <h3 className="text-[18px] font-bold text-gray-900 mb-4">Happy Hour</h3>

          {/* HH tagline — short summary like "Half-price apps & $5 beers 4–6 PM" */}
          {venue.happyHourTagline && (
            <p className="text-[14px] text-[#374151] mb-3">{venue.happyHourTagline}</p>
          )}

          {/* Blue info card with HH times + schedule toggle + specials.
              Mirrors renderHappyHourSection() from original index.html. */}
          <HappyHourTimesCard
            happyHourWeekly={venue.happyHourWeekly}
            specialsFood={venue.specialsFood}
            specialsDrinks={venue.specialsDrinks}
          />
        </div>

        {/* ── Info section ───────────────────────────────────────────────────
            Matches original #section-info .venue-section.
            Shows info rows matching original renderVenueInfo(). */}
        <div
          id="section-info"
          className="px-5 py-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          {/* Scroll anchor — same pattern as #anchor-happyhour above */}
          {/* eslint-disable-next-line jsx-a11y/aria-hidden-on-focusable */}
          <div
            id="anchor-info"
            aria-hidden="true"
            style={{ position: "relative", top: -196, height: 1 }}
          />
          <h3 className="text-[18px] font-bold text-gray-900 mb-4">Info</h3>

          {/* Info rows — matches original .venue-info-details:
              flat list with dividers, .info-list-row / .info-list-row-action.
              Reuses the exact same row pattern from event/[id]/page.tsx. */}
          <div className="flex flex-col">

            {/* Business Hours row — reused from event detail page */}
            {openDays.length > 0 && (
              <BusinessHoursRow hoursWeekly={venue.hoursWeekly} />
            )}

            {/* Address row — tappable, opens Google Maps */}
            {venue.address && (
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
                  <p className="text-[15px] text-gray-900 leading-[1.5] line-clamp-2 break-words">
                    {venue.address}
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
            {venue.phone && (
              <a
                href={`tel:${venue.phone}`}
                className="flex items-start justify-between py-[18px] min-h-[60px] border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors -mx-5 px-5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Phone
                  </p>
                  <p className="text-[15px] text-gray-900 leading-[1.5]">
                    {formatPhone(venue.phone)}
                  </p>
                </div>
                <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
              </a>
            )}

            {/* Payment row — static display, no icon */}
            {venue.paymentMethods && (
              <div className="flex items-start justify-between py-4 border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Payment
                  </p>
                  <p className="text-[15px] text-gray-900 leading-[1.5] break-words">
                    {venue.paymentMethods}
                  </p>
                </div>
              </div>
            )}

            {/* Website row — tappable, opens externally */}
            {venue.websiteUrl && (
              <a
                href={venue.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between py-[18px] min-h-[60px] border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors -mx-5 px-5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
                    Website
                  </p>
                  <p className="text-[15px] text-gray-900 leading-[1.5] truncate">
                    {venue.websiteUrl.replace(/^https?:\/\//, "")}
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

          </div>
        </div>

      </div>

      {/* ── Claim section ─────────────────────────────────────────────────────
          Only shown for unclaimed (seeded) venues. Hidden once claimed_at is set.
          Kept subtle — this is for operators discovering their venue, not consumers. */}
      {venue.claimedAt === null && (
        <div className="px-5 pt-4 pb-8 border-t border-gray-100">
          <p className="text-[12px] text-gray-400 mb-2">Own this venue?</p>
          <Link
            href={`/venue/${id}/claim`}
            className="text-[14px] font-medium text-blue-500 hover:text-blue-600 transition-colors"
          >
            Claim this venue
          </Link>
        </div>
      )}

    </main>
  );
}
