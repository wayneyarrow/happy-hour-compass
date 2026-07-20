/**
 * GET /api/preview/event/[id]
 *
 * Operator Admin "Preview" entry point for events — the event equivalent of
 * /api/preview/venue/[id] (see that route for the fuller design rationale;
 * this mirrors it exactly, minus the market/city canonical-path resolution
 * venues need, since the website event route is already ID-keyed directly
 * at /website-events/[id] with no slug/geography segments).
 *
 * Always requires the requester to be authorized for this specific event
 * (see canPreviewEvent) — both "event not found" and "not authorized"
 * return a generic 404 so the response never confirms whether a given id
 * belongs to a real (but inaccessible) event.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEventForWebsite } from "@/lib/data/events";
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

  return NextResponse.redirect(
    new URL(`/website-events/${event.id}?preview=true`, request.url)
  );
}
