/**
 * Canonical public venue URL builder — dependency-free (safe to import from
 * both Server and Client Components).
 *
 * Canonical shape: /{market-slug}/{city-slug}/{venue-slug}
 * (see docs/website/WEBSITE_PRODUCT_PLAYBOOK.md "Geographic Information
 * Architecture" and src/app/(website)/[market]/[city]/[slug]/page.tsx).
 *
 * Returns null instead of fabricating a URL when any segment is missing —
 * callers must handle the no-link case explicitly (e.g. a venue with no
 * assigned market/city cannot have a canonical public URL yet).
 */
export function buildVenuePublicPath(params: {
  marketSlug: string | null | undefined;
  citySlug: string | null | undefined;
  slug: string | null | undefined;
}): string | null {
  const { marketSlug, citySlug, slug } = params;
  if (!marketSlug || !citySlug || !slug) return null;
  return `/${marketSlug}/${citySlug}/${slug}`;
}
