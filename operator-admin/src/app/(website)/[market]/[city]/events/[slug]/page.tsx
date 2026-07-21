import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getEventForWebsiteBySlug,
  getEventByHistoricalSlug,
} from "@/lib/data/events";
import { buildEventPublicPath } from "@/lib/publicEventUrl";
import { buildEventMetadata } from "@/lib/seo/metadata";
import { canPreviewEvent } from "@/lib/venuePreviewAccess";
import { EventDetailContent } from "@/app/(website)/website-events/[id]/EventDetailContent";

/**
 * Canonical public event detail route: /{market}/{city}/events/{event-slug}
 * (see event URL architecture Phase 2 plan and
 * docs/website/WEBSITE_PRODUCT_PLAYBOOK.md's Geographic Information
 * Architecture). Mirrors the venue canonical route's resolution pattern
 * exactly — (website)/[market]/[city]/[slug]/page.tsx — adapted for events:
 * slug-first lookup (route segments validated, not trusted), historical-slug
 * redirect, canonical-mismatch redirect, and a graceful fallback to the
 * UUID compatibility route (/website-events/[id]) for the rare event whose
 * venue has no assigned market/city yet.
 *
 * Actual page rendering is shared with the UUID compatibility route via
 * EventDetailContent — this file is only responsible for resolving which
 * event (if any) the request maps to, and whether to redirect.
 */

// Always read fresh DB data — event status and sold-out state are time-sensitive.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ market: string; city: string; slug: string }>;
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

function eventDescription(event: {
  title: string;
  venueName: string;
  description: string | null;
  nextOccurrenceLabel: string;
}): string {
  return (
    event.description?.slice(0, 160) ||
    `${event.title} at ${event.venueName}. ${event.nextOccurrenceLabel}.`.trim()
  );
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;

  // Any request carrying ?preview=true is forced noindex regardless of
  // whether it turns out authorized — see the identical rationale on the
  // UUID compatibility route and the website venue page.
  if (isPreviewRequestedFromParams(resolvedSearchParams)) {
    const event = await getEventForWebsiteBySlug(slug, { includeUnpublished: true });
    if (!event) return { title: "Event", robots: { index: false, follow: false } };
    const path =
      buildEventPublicPath({
        marketSlug: event.venueMarketSlug,
        citySlug: event.venueCitySlug,
        eventSlug: event.slug,
      }) ?? `/website-events/${event.id}`;
    return {
      ...buildEventMetadata({
        eventName: `${event.title} at ${event.venueName}`,
        description: eventDescription(event),
        path,
        ogImage: event.imageUrl ?? undefined,
      }),
      robots: { index: false, follow: false },
    };
  }

  const event = await getEventForWebsiteBySlug(slug);
  if (!event) return { title: "Event" };
  const path =
    buildEventPublicPath({
      marketSlug: event.venueMarketSlug,
      citySlug: event.venueCitySlug,
      eventSlug: event.slug,
    }) ?? `/website-events/${event.id}`;
  return buildEventMetadata({
    eventName: `${event.title} at ${event.venueName}`,
    description: eventDescription(event),
    path,
    ogImage: event.imageUrl ?? undefined,
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EventDetailPage({ params, searchParams }: PageProps) {
  const { market, city, slug } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedPath = `/${market}/${city}/events/${slug}`;

  // Operator Admin's Preview button (via /api/preview/event/[id]) is the
  // only legitimate source of ?preview=true — it always redirects here (or
  // to the UUID fallback) already carrying the flag. A visitor who merely
  // copies a preview URL cannot use it unless they are also independently
  // re-authorized below for THIS event, so this flag alone never grants
  // access to unpublished data.
  const isPreviewRequested = isPreviewRequestedFromParams(resolvedSearchParams);

  // Event lookup is slug-first and does not depend on the market/city route
  // segments at all — events.slug is globally unique (DB UNIQUE NOT NULL
  // constraint, migration 001 + Phase 1 backfill). The route segments are
  // validated below against the event's own resolved geography (via its
  // venue), never trusted on their own — mirrors the venue page exactly.
  let event = await getEventForWebsiteBySlug(slug);
  let isPreviewAuthorized = false;

  // Unpublished (or nonexistent-under-normal-rules) event + preview
  // requested — re-fetch including unpublished rows and only use it once
  // the requester is independently confirmed authorized to manage this
  // exact event (see canPreviewEvent). Falls through to the normal
  // 404/redirect handling below when unauthorized, so this never weakens
  // the public path.
  if (!event && isPreviewRequested) {
    const previewCandidate = await getEventForWebsiteBySlug(slug, { includeUnpublished: true });
    if (previewCandidate && (await canPreviewEvent(previewCandidate.id))) {
      event = previewCandidate;
      isPreviewAuthorized = true;
    }
  }

  if (!event) {
    // No current event matches — only now check whether `slug` is a
    // retired alias in event_slug_history (migration 069). This runs once
    // per miss, never on a normal current-slug request. Historical lookups
    // never bypass publication rules (getEventByHistoricalSlug is
    // published-only, not a preview mechanism), so there is no preview
    // state to preserve through this branch.
    const historicalEvent = await getEventByHistoricalSlug(slug);
    if (!historicalEvent) notFound();

    const historicalCanonicalPath = buildEventPublicPath({
      marketSlug: historicalEvent.venueMarketSlug,
      citySlug: historicalEvent.venueCitySlug,
      eventSlug: historicalEvent.slug,
    });
    // The event this historical slug now belongs to has no resolvable
    // geography either — fall back to its UUID compatibility route rather
    // than asserting a canonical redirect target that doesn't exist.
    if (!historicalCanonicalPath) {
      permanentRedirect(`/website-events/${historicalEvent.id}`);
    }
    // Defensive redirect-loop guard — should be unreachable since a
    // retired slug can't also be the event's live canonical path.
    if (historicalCanonicalPath === requestedPath) notFound();

    permanentRedirect(historicalCanonicalPath);
  }

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

  if (!canonicalPath) {
    // This event's venue has no assigned market/city yet (nullable by
    // design — see WebsiteEventDetail.venueMarketSlug/venueCitySlug) — no
    // canonical URL exists under this route shape. Redirect to the UUID
    // compatibility route, which renders it directly as a graceful
    // fallback rather than 404ing a real, existing event. Preserve
    // ?preview=true explicitly — permanentRedirect() does not forward
    // query strings.
    permanentRedirect(
      isPreviewRequested
        ? `/website-events/${event.id}?preview=true`
        : `/website-events/${event.id}`
    );
  }

  // Single relational check covers every case this route needs to guard
  // against: wrong market, wrong city, a city that doesn't belong to that
  // market, or a stale slug from before a market/city reassignment — any
  // mismatch against the event's own resolved geography redirects to the
  // canonical URL instead of rendering a second copy of the page. Mirrors
  // the venue page's identical redirect-on-mismatch pattern.
  if (requestedPath !== canonicalPath) {
    permanentRedirect(isPreviewRequested ? `${canonicalPath}?preview=true` : canonicalPath);
  }

  return (
    <EventDetailContent
      event={event}
      eventCanonicalPath={canonicalPath}
      isPreviewAuthorized={isPreviewAuthorized}
    />
  );
}
