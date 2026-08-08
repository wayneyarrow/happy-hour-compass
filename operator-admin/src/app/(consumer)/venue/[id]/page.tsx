import { notFound } from "next/navigation";
import Link from "next/link";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";
import { getVenueImageSrc } from "@/lib/venuePlaceholderImage";
import { BookmarkButton } from "../../BookmarkButton";
import { ShareButton } from "../../event/[id]/ShareButton";
import { VenueJumpChips } from "./VenueJumpChips";
import { VenueDetailMeta } from "./VenueDetailMeta";
import { HappyHourTimesCard } from "./HappyHourTimesCard";
import { BusinessHoursRow } from "../../event/[id]/BusinessHoursRow";
import { BackButton } from "./BackButton";
import { VenueImageGallery } from "./VenueImageGallery";
import { GoogleRatingBadge } from "./GoogleRatingBadge";
import { VenueViewTracker } from "./VenueViewTracker";
import { VenueInfoRows } from "./VenueInfoRows";

// Time-sensitive data (open/closed status) — always read fresh.
export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const venue = await getVenueWithEventsForConsumerById(id);
  return { title: venue?.name ?? "Venue" };
}

type PageProps = {
  params: Promise<{ id: string }>;
};

const DAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

// This legacy consumer-app route never supported an authorized unpublished
// preview — it previously trusted a bare ?preview=true query string to
// enable includeUnpublished with no authorization check at all, letting
// anyone who knew or guessed a venue UUID view an unpublished venue. The
// authorized equivalent is the website Venue Detail page (see
// (website)/[market]/[city]/[slug]/page.tsx, gated by canPreviewVenue())
// reached via Operator Admin's Preview button through
// /api/preview/venue/[id]. No code in this app linked to this route's
// preview mode, so it is removed entirely rather than duplicated here —
// this route now always renders published venues only, exactly like every
// other normal "View" link into it.
export default async function VenuePage({ params }: PageProps) {
  const { id } = await params;

  const venue = await getVenueWithEventsForConsumerById(id);

  if (!venue) {
    notFound();
  }

  // Days with at least one business hours entry, Sun→Sat order.
  const openDays = DAY_ORDER.filter(
    (d) => venue.hoursWeekly[d] && venue.hoursWeekly[d] !== "CLOSED"
  );

  // Menu URL: prefer dedicated menu URL, fall back to website.
  const menuTarget = venue.menuUrl || venue.websiteUrl;

  // Google Maps URL: use place_id to open the business listing directly when
  // available, otherwise fall back to an address query.
  const mapsUrl = venue.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${venue.placeId}`
    : venue.address
    ? `https://www.google.com/maps?q=${encodeURIComponent(venue.address)}`
    : null;

  return (
    <main className="bg-white">
      <VenueViewTracker venueId={venue.venueUuid} city={venue.city} />

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
          <BookmarkButton venueId={id} variant="header" />
          <ShareButton />
        </div>
      </div>

      {/* ── Hero image + thumbnail strip ───────────────────────────────────────
          Gallery handles hero (always) + thumbnail strip (only when images > 1).
          Images list is derived here so future plan-based gating can be applied
          by slicing/filtering before passing to the component. */}
      <VenueImageGallery
        images={
          venue.images.length > 0
            ? venue.images
            : [{ url: getVenueImageSrc(venue) }]
        }
        venueName={venue.name}
      />

      {/* ── Name section ─────────────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4">
        {/* Venue name */}
        <h2
          className="text-[26px] font-bold text-[#111827] leading-[1.2] break-words tracking-tight mb-1"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {venue.name}
        </h2>

        {/* Verified badge */}
        {venue.isVerified && (
          <span className="inline-flex items-center gap-1 mt-2 mb-1 px-2.5 py-1 rounded-full bg-[#dbeafe] text-[#1e40af] text-[12px] font-semibold">
            ✓ Verified Venue
          </span>
        )}

        {/* Meta row — .venue-meta-row: status badge + distance + category tag */}
        <VenueDetailMeta
          hoursWeekly={venue.hoursWeekly}
          lat={venue.latitude}
          lng={venue.longitude}
          establishmentType={venue.establishmentType}
        />

        {/* Google rating — shown directly below meta row when data is present */}
        <GoogleRatingBadge
          googleRating={venue.googleRating}
          googleReviewCount={venue.googleReviewCount}
        />
      </div>


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
          className="px-5 pt-6 pb-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          {/* eslint-disable-next-line jsx-a11y/aria-hidden-on-focusable */}
          <div
            id="anchor-happyhour"
            aria-hidden="true"
            style={{ position: "relative", top: -196, height: 1 }}
          />
          <h3 className="text-[19px] font-bold text-gray-900 mb-4 tracking-tight">Happy Hour</h3>

          {/* HH tagline — short summary like "Half-price apps & $5 beers 4–6 PM" */}
          {venue.happyHourTagline && (
            <p className="text-[14px] text-[#374151] mb-3">{venue.happyHourTagline}</p>
          )}

          {/* Blue info card with HH times + schedule toggle + specials.
              Mirrors renderHappyHourSection() from original index.html. */}
          <HappyHourTimesCard
            venueId={id}
            happyHourWeekly={venue.happyHourWeekly}
            specialsFood={venue.specialsFood}
            specialsDrinks={venue.specialsDrinks}
          />
        </div>

        {/* Section divider */}
        <div className="mx-5 border-t border-gray-100" />

        {/* ── Info section ───────────────────────────────────────────────────
            Matches original #section-info .venue-section.
            Shows info rows matching original renderVenueInfo(). */}
        <div
          id="section-info"
          className="px-5 pt-6 pb-5 min-h-[300px]"
          style={{ scrollMarginTop: 150 }}
        >
          {/* Scroll anchor — same pattern as #anchor-happyhour above */}
          {/* eslint-disable-next-line jsx-a11y/aria-hidden-on-focusable */}
          <div
            id="anchor-info"
            aria-hidden="true"
            style={{ position: "relative", top: -196, height: 1 }}
          />
          <h3 className="text-[19px] font-bold text-gray-900 mb-4 tracking-tight">Info</h3>

          {/* Info rows — BusinessHoursRow stays server-side; tappable link rows
              are extracted to VenueInfoRows (client) to enable click tracking. */}
          <div className="flex flex-col">

            {openDays.length > 0 && (
              <BusinessHoursRow hoursWeekly={venue.hoursWeekly} venueId={id} />
            )}

            <VenueInfoRows
              venueId={id}
              city={venue.city}
              address={venue.address}
              mapsUrl={mapsUrl}
              menuTarget={menuTarget}
              phone={venue.phone}
              websiteUrl={venue.websiteUrl}
              paymentMethods={venue.paymentMethods}
            />

          </div>

          {/* Search tags — only rendered when the venue has tags */}
          {venue.searchTags.length > 0 && (
            <div className="mt-5">
              <p className="text-[12px] font-semibold uppercase tracking-[0.5px] text-gray-500 mb-2">
                Tags
              </p>
              <div className="flex flex-wrap gap-2">
                {venue.searchTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-[13px] font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Freshness indicator ───────────────────────────────────────────────
          Informational only. Uses absolute date format so consumers don't feel
          the information is stale — older dates don't mean inaccurate content. */}
      {venue.updatedAt && (
        <div className="px-5 pt-4 pb-2 border-t border-gray-100">
          <p className="text-[12px] text-gray-400">
            Last updated{" "}
            {new Date(venue.updatedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      )}

      {/* ── Claim section ─────────────────────────────────────────────────────
          Only shown for unclaimed (seeded) venues. Hidden once claimed_at is set. */}
      {venue.claimedAt === null && (
        <div className="mx-5 mb-8">
          <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", border: "1px solid #fde68a" }}>
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4.5 h-4.5 text-amber-700"
                style={{ width: 18, height: 18 }}
                aria-hidden="true"
              >
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <rect x="9" y="12" width="6" height="9" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-amber-900 mb-0.5">Own or manage this venue?</p>
              <Link
                href={`/venue/${id}/claim`}
                className="text-[13px] font-medium text-amber-700 hover:text-amber-800 transition-colors"
              >
                Claim this venue →
              </Link>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
