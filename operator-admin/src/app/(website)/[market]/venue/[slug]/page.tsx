import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";
import { getMarketById } from "@/lib/markets";
import { GoogleRatingBadge } from "@/app/(consumer)/venue/[id]/GoogleRatingBadge";
import { SaveVenueButton } from "@/app/(website)/SaveVenueButton";
import { ShareButton } from "@/app/(consumer)/event/[id]/ShareButton";
import { HappyHourTimesCard } from "@/app/(consumer)/venue/[id]/HappyHourTimesCard";
import { BusinessHoursRow } from "@/app/(consumer)/event/[id]/BusinessHoursRow";
import { VenueViewTracker } from "@/app/(consumer)/venue/[id]/VenueViewTracker";
import { VenueGallery } from "./VenueGallery";
import { StickyNav } from "./StickyNav";
import { VenueActionCard } from "./VenueActionCard";
import { VenueIdentityStatus } from "./VenueIdentityStatus";
import { MobileActionBar } from "./MobileActionBar";
import { VenueDetailMap } from "./VenueDetailMap";
import { ClaimVenueCTA } from "./ClaimVenueCTA";

// Always read fresh DB data — page is time-sensitive (open status, HH status).
export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fallbackImage(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar") || t.includes("brewery") || t.includes("pub"))
    return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const DAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

// ─── Metadata ─────────────────────────────────────────────────────────────────

type PageProps = {
  params: Promise<{ market: string; slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, market } = await params;
  const venue = await getVenueWithEventsForConsumerById(slug);
  const marketConfig = getMarketById(market);
  if (!venue) return { title: "Venue | Happy Hour Compass" };
  return {
    title: `${venue.name} Happy Hour | ${marketConfig?.name ?? "Happy Hour Compass"}`,
    description:
      venue.happyHourTagline ||
      `Happy hour deals at ${venue.name} in ${venue.city}. See the full schedule, specials, and info.`,
  };
}

// ─── Info row helper ──────────────────────────────────────────────────────────

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

// ─── Verified badge ───────────────────────────────────────────────────────────

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
      <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
      Verified Venue
    </span>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-gray-900 mb-5 tracking-tight leading-snug">
      {children}
    </h2>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function VenueDetailPage({ params }: PageProps) {
  const { market, slug } = await params;

  const marketConfig = getMarketById(market);
  if (!marketConfig) notFound();

  const venue = await getVenueWithEventsForConsumerById(slug);
  if (!venue) notFound();

  // Images: real uploaded images or type-based fallback.
  const images =
    venue.images.length > 0
      ? venue.images
      : [{ url: fallbackImage(venue.establishmentType) }];

  // Section visibility flags.
  const hasFood = venue.specialsFood.length > 0;
  const hasDrinks = venue.specialsDrinks.length > 0;
  const hasSpecials = hasFood || hasDrinks;
  const hasEvents = venue.events.length > 0;
  const hasAbout = Boolean(venue.aboutYourVenue?.trim());
  const hasBusinessHours = DAY_ORDER.some(
    (d) => venue.hoursWeekly[d] && venue.hoursWeekly[d] !== "CLOSED"
  );

  // External links.
  const menuUrl = venue.menuUrl || null;
  const websiteUrl = venue.websiteUrl || null;
  const mapsUrl = venue.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${venue.placeId}`
    : venue.address
    ? `https://www.google.com/maps?q=${encodeURIComponent(venue.address)}`
    : null;

  // Nav sections — only sections that will render.
  const sections = [
    { id: "happy-hour", label: "Happy Hour" },
    ...(hasSpecials ? [{ id: "specials", label: "Specials" }] : []),
    ...(hasEvents ? [{ id: "events", label: "Events" }] : []),
    ...(hasAbout ? [{ id: "about", label: "About" }] : []),
    { id: "info", label: "Info" },
  ];

  // Scroll-margin accounts for website header (72px) + sticky section nav (~48px) + buffer.
  const SCROLL_MARGIN = 132;

  return (
    <div className="bg-white pb-20 lg:pb-0">
      <VenueViewTracker venueId={venue.venueUuid} city={venue.city} />

      {/* ── Gallery ──────────────────────────────────────────────────────────── */}
      <VenueGallery images={images} venueName={venue.name} />

      {/* ── Page content ─────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-500 pt-5 pb-4 min-w-0">
          <Link href="/" className="hover:text-gray-900 transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
            Home
          </Link>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-gray-300" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <Link
            href="/website-happy-hours"
            className="hover:text-gray-900 transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {marketConfig.name}
          </Link>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-gray-300" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-gray-900 font-medium truncate min-w-0">{venue.name}</span>
        </nav>

        {/* ── Venue identity ──────────────────────────────────────────────────── */}
        <div className="pb-6 border-b border-gray-100">

          {/* Row 1: Venue name + Save/Share */}
          <div className="flex items-start gap-3 mb-2">
            <h1 className="flex-1 min-w-0 text-2xl md:text-3xl lg:text-[2rem] font-bold text-gray-900 leading-tight tracking-tight">
              {venue.name}
            </h1>
            <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
              <SaveVenueButton venueId={venue.venueUuid} variant="detail" />
              <ShareButton />
            </div>
          </div>

          {/* Row 2: Type · City */}
          {(venue.establishmentType || venue.city) && (
            <p className="text-[15px] text-gray-500 mb-3 leading-snug">
              {[venue.establishmentType, venue.city].filter(Boolean).join(" · ")}
            </p>
          )}

          {/* Row 3: Rating + Verified */}
          <div className="flex items-center gap-3 flex-wrap">
            <GoogleRatingBadge
              googleRating={venue.googleRating}
              googleReviewCount={venue.googleReviewCount}
            />
            {venue.isVerified && <VerifiedBadge />}
          </div>

          {/* Row 4: Live status pills (open/closed · HH status) — client-rendered */}
          <VenueIdentityStatus
            happyHourWeekly={venue.happyHourWeekly}
            hoursWeekly={venue.hoursWeekly}
          />
        </div>

        {/* Sticky section nav */}
        <StickyNav sections={sections} />

        {/* ── Content grid ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-10 xl:gap-16 pt-10">

          {/* ── Left: main content ─────────────────────────────────────────── */}
          <div className="min-w-0 space-y-14">

            {/* ── Happy Hour ─────────────────────────────────────────────────── */}
            <section id="happy-hour" style={{ scrollMarginTop: SCROLL_MARGIN }}>
              <SectionHeading>Happy Hour</SectionHeading>
              {venue.happyHourTagline && (
                <p className="text-base text-gray-600 mb-5 leading-relaxed -mt-1">
                  {venue.happyHourTagline}
                </p>
              )}
              {/* Pass empty specials — specials render in their own section below */}
              <HappyHourTimesCard
                venueId={venue.id}
                happyHourWeekly={venue.happyHourWeekly}
                specialsFood={[]}
                specialsDrinks={[]}
              />
            </section>

            {/* ── Specials ───────────────────────────────────────────────────── */}
            {hasSpecials && (
              <section id="specials" style={{ scrollMarginTop: SCROLL_MARGIN }}>
                <SectionHeading>Happy Hour Specials</SectionHeading>
                <div
                  className={`grid gap-8 ${
                    hasFood && hasDrinks ? "sm:grid-cols-2" : ""
                  }`}
                >
                  {hasFood && (
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-4 h-4 text-amber-500 shrink-0"
                          aria-hidden="true"
                        >
                          <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
                          <path d="M7 2v20" />
                          <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3v7" />
                        </svg>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Food
                        </h3>
                      </div>
                      <ul className="space-y-3">
                        {venue.specialsFood.map((item, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[15px] text-gray-700 leading-snug">
                            <span className="text-amber-400 shrink-0 mt-0.5 font-bold" aria-hidden="true">·</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {hasDrinks && (
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-4 h-4 text-amber-500 shrink-0"
                          aria-hidden="true"
                        >
                          <path d="M8 22h8" />
                          <path d="M7 10h10l-2 9H9Z" />
                          <path d="m12 10-.5-8" />
                          <path d="m7 2 1.5 2" />
                          <path d="m17 2-1.5 2" />
                          <path d="m9.5 2 1 2" />
                          <path d="m14.5 2-1 2" />
                        </svg>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Drinks
                        </h3>
                      </div>
                      <ul className="space-y-3">
                        {venue.specialsDrinks.map((item, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[15px] text-gray-700 leading-snug">
                            <span className="text-amber-400 shrink-0 mt-0.5 font-bold" aria-hidden="true">·</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ── Events ─────────────────────────────────────────────────────── */}
            {hasEvents && (
              <section id="events" style={{ scrollMarginTop: SCROLL_MARGIN }}>
                <SectionHeading>Upcoming Events</SectionHeading>
                <div className="space-y-3">
                  {venue.events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-4 p-5 rounded-xl border border-gray-100 bg-gray-50/60 hover:bg-gray-50 transition-colors"
                    >
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#d97706"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-5 h-5"
                          aria-hidden="true"
                        >
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 leading-snug text-[15px]">
                          {event.title}
                        </p>
                        {event.nextOccurrenceLabel && (
                          <p className="text-sm text-amber-700 font-medium mt-0.5">
                            {event.nextOccurrenceLabel}
                          </p>
                        )}
                        {event.description && (
                          <p className="text-sm text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">
                            {event.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── About ──────────────────────────────────────────────────────── */}
            {hasAbout && (
              <section id="about" style={{ scrollMarginTop: SCROLL_MARGIN }}>
                <SectionHeading>About {venue.name}</SectionHeading>
                <p className="text-[15px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {venue.aboutYourVenue}
                </p>
              </section>
            )}

            {/* ── Business Info ───────────────────────────────────────────────── */}
            <section id="info" style={{ scrollMarginTop: SCROLL_MARGIN }}>
              <SectionHeading>Business Info</SectionHeading>
              {/* Business hours — rendered outside divide-y because BusinessHoursRow
                  manages its own border-b internally (consumer component, can't modify). */}
              {hasBusinessHours && (
                <BusinessHoursRow hoursWeekly={venue.hoursWeekly} venueId={venue.id} />
              )}

              <div className="divide-y divide-gray-100">
                {venue.address && (
                  <InfoRow
                    label="Address"
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    }
                  >
                    <a
                      href={mapsUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-blue-600 transition-colors"
                    >
                      {venue.address}
                    </a>
                  </InfoRow>
                )}

                {venue.phone && (
                  <InfoRow
                    label="Phone"
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 8 19.79 19.79 0 0 1 1.04 4.11a2 2 0 0 1 1.72-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    }
                  >
                    <a href={`tel:${venue.phone}`} className="hover:text-blue-600 transition-colors">
                      {formatPhone(venue.phone)}
                    </a>
                  </InfoRow>
                )}

                {websiteUrl && (
                  <InfoRow
                    label="Website"
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    }
                  >
                    <a
                      href={websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 transition-colors break-all"
                    >
                      {websiteUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </InfoRow>
                )}

                {menuUrl && (
                  <InfoRow
                    label="Menu"
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                        <rect x="9" y="3" width="6" height="4" rx="1" ry="1" />
                        <line x1="9" y1="12" x2="15" y2="12" />
                        <line x1="9" y1="16" x2="12" y2="16" />
                      </svg>
                    }
                  >
                    <a
                      href={menuUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      View menu
                    </a>
                  </InfoRow>
                )}

                {venue.paymentMethods && (
                  <InfoRow
                    label="Payment"
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                        <line x1="1" y1="10" x2="23" y2="10" />
                      </svg>
                    }
                  >
                    <span className="font-normal text-gray-600">{venue.paymentMethods}</span>
                  </InfoRow>
                )}
              </div>
            </section>

            {/* Venue map */}
            <VenueDetailMap
              lat={venue.latitude}
              lng={venue.longitude}
              venueName={venue.name}
              mapsUrl={mapsUrl}
            />

            {/* Last updated */}
            {venue.updatedAt && (
              <p className="text-xs text-gray-400">
                Last updated{" "}
                {new Date(venue.updatedAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}

            {/* Claim this venue */}
            {venue.claimedAt === null && (
              <ClaimVenueCTA venueRouteParam={venue.id} venueName={venue.name} />
            )}

            <div className="h-4" aria-hidden="true" />
          </div>

          {/* ── Right: sticky action card (desktop only) ───────────────────── */}
          <div className="hidden lg:block">
            <div className="sticky top-36">
              <VenueActionCard
                happyHourWeekly={venue.happyHourWeekly}
                hoursWeekly={venue.hoursWeekly}
                lat={venue.latitude}
                lng={venue.longitude}
                phone={venue.phone}
                websiteUrl={websiteUrl ?? ""}
                menuUrl={menuUrl}
                mapsUrl={mapsUrl}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom action bar (hidden on desktop) */}
      <MobileActionBar
        phone={venue.phone}
        mapsUrl={mapsUrl}
        menuUrl={menuUrl}
        websiteUrl={websiteUrl ?? ""}
      />
    </div>
  );
}
