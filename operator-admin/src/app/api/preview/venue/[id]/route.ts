/**
 * GET /api/preview/venue/[id]
 *
 * Operator Admin "Preview" entry point. Resolves the venue's canonical
 * public website URL (/{market}/{city}/{slug}) and redirects to it with
 * ?preview=true, instead of linking directly to a guessed URL — the
 * operator only ever supplies the venue's DB id/slug, never the market and
 * city segments the canonical route requires.
 *
 * Centralizing the redirect here (rather than building the link in each
 * Operator Admin page) keeps the market/city lookup and the authorization
 * check in one place. `id` accepts either the venue's slug or its raw UUID —
 * getVenueWithEventsForConsumerById already resolves both.
 *
 * Always requires the requester to be authorized for this specific venue
 * (see canPreviewVenue) — both "venue not found" and "not authorized"
 * return a generic 404 so the response never confirms whether a given id
 * belongs to a real (but inaccessible) venue.
 */

import { NextRequest, NextResponse } from "next/server";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { canPreviewVenue } from "@/lib/venuePreviewAccess";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const venue = await getVenueWithEventsForConsumerById(id, {
    includeUnpublished: true,
  });

  if (!venue || !(await canPreviewVenue(venue.venueUuid))) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const canonicalPath = buildVenuePublicPath({
    marketSlug: venue.marketSlug,
    citySlug: venue.citySlug,
    slug: venue.id,
  });

  if (!canonicalPath) {
    return new NextResponse(
      "This venue has no public preview URL yet — it needs a market and city assigned first.",
      { status: 404 }
    );
  }

  return NextResponse.redirect(
    new URL(`${canonicalPath}?preview=true`, request.url)
  );
}
