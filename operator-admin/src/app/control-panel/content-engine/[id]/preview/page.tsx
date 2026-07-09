import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getGuideForPreview, getRelatedGuides } from "@/lib/data/contentGuides";
import {
  getGuideVenueAttachments,
  getGuideEventAttachments,
} from "@/lib/data/contentGuideAttachments";
import { getGuideFaqs } from "@/lib/data/faqLibrary";
import { getPublishedVenuesByUuids, type ConsumerVenue } from "@/lib/data/venues";
import { getPublishedEventsByIds, type WebsiteEventListItem } from "@/lib/data/events";
import { computeHhStatus } from "@/lib/happyHourStatus";
import type { SearchResultCardData } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { GuideDetailView } from "@/app/(website)/[market]/guides/[slug]/GuideDetailView";

/**
 * Admin-safe guide preview (Guide Experience V2 Card 2A).
 *
 * Renders Draft and Published guides identically to the public route, by
 * reusing GuideDetailView — see that component's docstring for what it does
 * and doesn't render yet (still the legacy body-based layout; the new
 * editorial sections aren't visually wired in until Card 2B).
 *
 * Protection is inherited, not bespoke:
 *   - Auth: every /control-panel/* route is gated by control-panel/layout.tsx
 *     (redirects unauthenticated or non-allowlisted users before this page
 *     ever runs) — see that file's docstring.
 *   - Indexing: /control-panel is already disallowed in robots.ts. The
 *     `robots` metadata below is defense-in-depth in case this page is ever
 *     linked from somewhere crawlable.
 *
 * Looked up by id, not slug — the whole point is previewing a guide before
 * (or without) it ever having a live public URL.
 *
 * Card 2D: GuideDetailView now also renders GuideFaqSection, which emits a
 * FAQPage JSON-LD <script> tag when the guide has FAQs. That's fine here —
 * JSON-LD carries no indexing directive of its own, and this route is
 * already noindexed/auth-gated per the protection notes above.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview Guide — Control Panel",
  robots: { index: false, follow: false },
};

function fallbackImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar") || t.includes("brewery") || t.includes("pub"))
    return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

export default async function GuidePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const guide = await getGuideForPreview(id);
  if (!guide) notFound();

  const isVenueGuide = guide.guide_type === "venue_guide";

  const [attachments, relatedGuides, faqs] = await Promise.all([
    isVenueGuide ? getGuideVenueAttachments(guide.id) : getGuideEventAttachments(guide.id),
    getRelatedGuides(guide.marketSlug, guide.id),
    getGuideFaqs(guide.id),
  ]);
  const orderedIds = attachments.map((a) => a.id);

  // Same caveat as the public page: only *published* venues/events resolve
  // here. A Draft guide attached to a not-yet-published venue/event will
  // preview as "not added yet" for that item until the venue/event is
  // itself published — see Card 2B follow-up notes.
  let venueCards: SearchResultCardData[] = [];
  let eventItems: WebsiteEventListItem[] = [];

  if (isVenueGuide && orderedIds.length > 0) {
    const venues = await getPublishedVenuesByUuids(orderedIds);
    const byId = new Map(venues.map((v) => [v.venueUuid, v]));
    venueCards = orderedIds
      .map((vid) => byId.get(vid))
      .filter((v): v is ConsumerVenue => Boolean(v))
      .map((v) => ({
        id: v.id,
        venueUuid: v.venueUuid,
        href: `/${guide.marketSlug}/venue/${v.id}`,
        name: v.name,
        image: v.images[0]?.url ?? fallbackImage(v.establishmentType),
        isVerified: v.isVerified,
        googleRating: v.googleRating,
        hhStatus: computeHhStatus(v.happyHourWeekly),
        distanceKm: null,
        establishmentType: v.establishmentType,
        foodSpecial: v.specialsFood[0] ?? undefined,
        drinkSpecial: v.specialsDrinks[0] ?? undefined,
      }));
  } else if (!isVenueGuide && orderedIds.length > 0) {
    const events = await getPublishedEventsByIds(orderedIds);
    const byId = new Map(events.map((e) => [e.id, e]));
    eventItems = orderedIds
      .map((eid) => byId.get(eid))
      .filter((e): e is WebsiteEventListItem => Boolean(e));
  }

  const isPublished = guide.status === "published";

  return (
    <div>
      <div
        className={`mb-6 rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
          isPublished ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
        }`}
      >
        <div className="flex items-center gap-2.5 text-sm">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              isPublished ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {isPublished ? "Published" : "Draft"}
          </span>
          <span className="text-gray-600">
            {isPublished
              ? "This guide is live at its public URL."
              : "Draft preview — not visible to the public."}
          </span>
        </div>
        <Link
          href={`/control-panel/content-engine/${guide.id}/edit`}
          className="shrink-0 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          ← Back to Edit
        </Link>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <GuideDetailView
          guide={guide}
          isVenueGuide={isVenueGuide}
          venueCards={venueCards}
          eventItems={eventItems}
          relatedGuides={relatedGuides}
          faqs={faqs}
        />
      </div>
    </div>
  );
}
