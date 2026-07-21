/**
 * GET /api/preview/event/[id]
 *
 * Operator Admin "Preview" entry point for events — mirrors
 * /api/preview/venue/[id] (see that route for the fuller design rationale).
 * Resolves the event's canonical public URL
 * (/{market}/{city}/events/{event-slug}) and redirects to it with
 * ?preview=true, falling back to the UUID compatibility route
 * (/website-events/{id}?preview=true) when the event's venue has no
 * assigned market/city yet — same graceful-fallback behaviour as the
 * canonical route itself (see (website)/[market]/[city]/events/[slug]/
 * page.tsx). `id` always accepts the event's raw UUID — this is an
 * internal, operator-only entry point, never linked from any public
 * surface, so there is no reason for it to be slug-aware.
 *
 * Always requires the requester to be authorized for this specific event
 * (see canPreviewEvent) — both "event not found" and "not authorized"
 * return a generic 404 so the response never confirms whether a given id
 * belongs to a real (but inaccessible) event.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEventForWebsite } from "@/lib/data/events";
import { buildEventPublicPath } from "@/lib/publicEventUrl";
import { canPreviewEvent } from "@/lib/venuePreviewAccess";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const event = await getEventForWebsite(id, { includeUnpublished: true });

  if (!event || !(await canPreviewEvent(event.id))) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const canonicalPath = buildEventPublicPath({
    marketSlug: event.venueMarketSlug,
    citySlug: event.venueCitySlug,
    eventSlug: event.slug,
  });

  const destination = canonicalPath ?? `/website-events/${event.id}`;

  return NextResponse.redirect(
    new URL(`${destination}?preview=true`, request.url)
  );
}
