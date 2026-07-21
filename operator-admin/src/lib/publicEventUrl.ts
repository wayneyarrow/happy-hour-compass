/**
 * Canonical public event URL builder — dependency-free (safe to import from
 * both Server and Client Components), mirroring publicVenueUrl.ts.
 *
 * Canonical shape (Phase 2): /{market-slug}/{city-slug}/events/{event-slug}
 * (see docs/website/WEBSITE_PRODUCT_PLAYBOOK.md "Geographic Information
 * Architecture" and the venue equivalent, src/app/(website)/[market]/[city]/
 * [slug]/page.tsx).
 *
 * Phase 1 only adds this helper — no route or caller uses it yet (see
 * event-url-architecture Phase 1 scope). It returns null instead of
 * fabricating a URL when any segment is missing — callers must handle the
 * no-link case explicitly (e.g. an event whose venue has no assigned
 * market/city cannot have a canonical public URL yet), exactly like
 * buildVenuePublicPath(). Never falls back to the event's UUID.
 */
export function buildEventPublicPath(params: {
  marketSlug: string | null | undefined;
  citySlug: string | null | undefined;
  eventSlug: string | null | undefined;
}): string | null {
  const { marketSlug, citySlug, eventSlug } = params;
  if (!marketSlug || !citySlug || !eventSlug) return null;
  return `/${marketSlug}/${citySlug}/events/${eventSlug}`;
}
