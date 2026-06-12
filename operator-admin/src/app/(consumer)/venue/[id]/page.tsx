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
import { VenueImageGallery } from "./VenueImageGallery";
import { GoogleRatingBadge } from "./GoogleRatingBadge";
import { VenueViewTracker } from "./VenueViewTracker";
import { VenueInfoRows } from "./VenueInfoRows";

// Never serve a stale version — preview mode must always read live DB data.
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
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const DAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

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

  // Fallback image when venue has no uploaded images.
  const fallbackImageSrc = getVenueImageSrc(venue.establishmentType);

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

      {isPreview && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 font-medium">
          Preview mode — this venue may not be publicly visible yet.
        </div>
      )}

      {/* ── Hero image + thumbnail strip ───────────────────────────────────────
          Gallery handles hero (always) + thumbnail strip (only when images > 1).
          Images list is derived here so future plan-based gating can be applied
          by slicing/filtering before passing to the component. */}
      <VenueImageGallery
        images={
          venue.images.length > 0
            ? venue.images
            : [{ url: fallbackImageSrc }]
        }
        venueName={venue.name}
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

        {/* Verified badge — shown only for operator-claimed venues */}
        {venue.isVerified && (
          <span className="inline-block mt-2 mb-1 px-2 py-[3px] rounded-full bg-[#dbeafe] text-[#1e40af] text-[12px] font-medium">
            Verified Venue ✓
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

          {/* Info rows — BusinessHoursRow stays server-side; tappable link rows
              are extracted to VenueInfoRows (client) to enable click tracking. */}
          <div className="flex flex-col">

            {openDays.length > 0 && (
              <BusinessHoursRow hoursWeekly={venue.hoursWeekly} />
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
