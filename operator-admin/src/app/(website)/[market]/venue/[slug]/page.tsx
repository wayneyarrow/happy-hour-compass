import { notFound, permanentRedirect } from "next/navigation";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";

/**
 * Legacy venue route — superseded by the canonical
 * /{market}/{city}/{venue-slug} route at
 * (website)/[market]/[city]/[slug]/page.tsx.
 *
 * This route no longer renders venue content. It exists only to permanently
 * redirect old /{market}/venue/{slug} links (and any raw-UUID variant, via
 * getVenueWithEventsForConsumerById's slug-then-UUID fallback) to the
 * venue's real canonical URL, derived from its own stored market/city
 * relationship rather than the incoming `market` route segment.
 */

type PageProps = {
  params: Promise<{ market: string; slug: string }>;
};

export default async function LegacyVenueRoute({ params }: PageProps) {
  const { slug } = await params;

  const venue = await getVenueWithEventsForConsumerById(slug);
  if (!venue) notFound();

  const canonicalPath = buildVenuePublicPath({
    marketSlug: venue.marketSlug,
    citySlug: venue.citySlug,
    slug: venue.id,
  });
  // No assigned market/city — no canonical URL exists for this venue yet.
  if (!canonicalPath) notFound();

  permanentRedirect(canonicalPath);
}
