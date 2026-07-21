import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { getEventForWebsite } from "@/lib/data/events";
import { buildEventMetadata } from "@/lib/seo/metadata";
import { buildEventPublicPath } from "@/lib/publicEventUrl";
import { canPreviewEvent } from "@/lib/venuePreviewAccess";
import { EventDetailContent } from "./EventDetailContent";

/**
 * UUID compatibility route for the event detail page.
 *
 * The canonical public event route is now
 * (website)/[market]/[city]/events/[slug]/page.tsx
 * (/{market}/{city}/events/{event-slug}) — see the event URL architecture
 * Phase 2 plan. This route exists only to:
 *   1. Permanently redirect any existing /website-events/{uuid} link
 *      (bookmarked, shared, or already indexed) to that canonical URL.
 *   2. Preserve Operator Admin's ?preview=true preview flow, redirecting it
 *      to the canonical URL with the query string re-appended (see the
 *      "important" note below).
 *   3. Gracefully render the event directly, HERE, in the one case where no
 *      canonical URL exists yet: the event's venue has no assigned
 *      market/city (nullable by design). This is the only case where this
 *      route is genuinely self-canonical — see generateMetadata below and
 *      sitemap.ts, which excludes this fallback population from the
 *      slug-based sitemap.
 *
 * Never renders a second, competing copy of a page that already has a
 * canonical slug URL — whenever canonicalPath resolves, this route ALWAYS
 * redirects (a 308 response has no body/head, so whatever generateMetadata
 * computed for that request is simply discarded, never served).
 */

// Always read fresh DB data — event status and sold-out state are time-sensitive.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function isPreviewRequestedFromParams(
  resolvedSearchParams: Awaited<PageProps["searchParams"]>
): boolean {
  return (
    resolvedSearchParams.preview === "true" ||
    (Array.isArray(resolvedSearchParams.preview) &&
      resolvedSearchParams.preview.includes("true"))
  );
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  // Any request carrying ?preview=true is forced noindex regardless of
  // whether it turns out authorized — a legitimate visitor never adds this
  // query param, so there is no cost to normal published-page SEO, and it
  // means preview metadata can never accidentally represent unpublished
  // content as publicly indexable (see requirement: preview pages must not
  // be indexable). Authorization itself is still fully enforced separately
  // by the page body below; this only controls the robots directive.
  if (isPreviewRequestedFromParams(resolvedSearchParams)) {
    const event = await getEventForWebsite(id, { includeUnpublished: true });
    if (!event) return { title: "Event", robots: { index: false, follow: false } };
    return {
      ...buildEventMetadata({
        eventName: `${event.title} at ${event.venueName}`,
        description:
          event.description?.slice(0, 160) ||
          `${event.title} at ${event.venueName}. ${event.nextOccurrenceLabel}.`.trim(),
        path: `/website-events/${id}`,
        ogImage: event.imageUrl ?? undefined,
      }),
      robots: { index: false, follow: false },
    };
  }

  const event = await getEventForWebsite(id);
  if (!event) return { title: "Event" };
  // Note: this always declares /website-events/{id} as canonical, even for
  // an event that DOES have a resolvable slug path (and will therefore
  // redirect away in the page body below). That's intentional, not a bug —
  // this metadata is only ever actually served in the one case where the
  // page body doesn't redirect (the geography-missing fallback), since a
  // redirect response has no body/head to serve metadata into. See this
  // file's top-of-file comment.
  return buildEventMetadata({
    eventName: `${event.title} at ${event.venueName}`,
    description:
      event.description?.slice(0, 160) ||
      `${event.title} at ${event.venueName}. ${event.nextOccurrenceLabel}.`.trim(),
    path: `/website-events/${id}`,
    ogImage: event.imageUrl ?? undefined,
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WebsiteEventCompatPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  // Operator Admin's Preview button (via /api/preview/event/[id]) is the
  // only legitimate source of ?preview=true — it always redirects here
  // already carrying the flag. A visitor who merely copies a preview URL
  // cannot use it unless they are also independently re-authorized below
  // for THIS event, so this flag alone never grants access to unpublished
  // data. Mirrors the identical pattern already used by the website venue
  // page (see (website)/[market]/[city]/[slug]/page.tsx).
  const isPreviewRequested = isPreviewRequestedFromParams(resolvedSearchParams);

  let event = await getEventForWebsite(id);
  let isPreviewAuthorized = false;

  // Unpublished (or nonexistent-under-normal-rules) event + preview
  // requested — re-fetch including unpublished rows and only use it once
  // the requester is independently confirmed authorized to manage this
  // exact event (see canPreviewEvent). Falls through to the normal 404
  // handling below when unauthorized, so this never weakens the public path.
  if (!event && isPreviewRequested) {
    const previewCandidate = await getEventForWebsite(id, { includeUnpublished: true });
    if (previewCandidate && (await canPreviewEvent(previewCandidate.id))) {
      event = previewCandidate;
      isPreviewAuthorized = true;
    }
  }

  if (!event) notFound();

  // A published event reached normally, but still requested with
  // ?preview=true (e.g. the operator previewing an already-live event) —
  // authorize separately so the banner only ever renders for the operator
  // who manages it, never for a visitor who stumbled on the same query param.
  if (isPreviewRequested && !isPreviewAuthorized) {
    isPreviewAuthorized = await canPreviewEvent(event.id);
  }

  const canonicalPath = buildEventPublicPath({
    marketSlug: event.venueMarketSlug,
    citySlug: event.venueCitySlug,
    eventSlug: event.slug,
  });

  if (canonicalPath) {
    // IMPORTANT: permanentRedirect() does NOT forward query strings (this
    // is empirically confirmed by this same page's own existing comment on
    // the "View Full Happy Hour Schedule" CTA below, and by the venue
    // page's identical redirect pattern) — ?preview=true must be
    // re-appended explicitly, or an authorized preview link would silently
    // lose its preview state (and its noindex signal) the instant this
    // redirect fires. Fragments need no equivalent handling — they never
    // reach the server and survive any redirect automatically via normal
    // browser behaviour.
    permanentRedirect(isPreviewRequested ? `${canonicalPath}?preview=true` : canonicalPath);
  }

  // Graceful fallback: this event's venue has no resolvable market/city yet
  // (nullable by design — see WebsiteEventDetail.venueMarketSlug/
  // venueCitySlug). There is no canonical URL to redirect to, so this route
  // renders the event directly rather than breaking it or fabricating
  // placeholder geography. This is this event's real, self-canonical public
  // URL until its venue's geography is assigned — excluded from the
  // slug-based sitemap (see sitemap.ts) for the same reason.
  return (
    <EventDetailContent
      event={event}
      eventCanonicalPath={`/website-events/${id}`}
      isPreviewAuthorized={isPreviewAuthorized}
    />
  );
}
