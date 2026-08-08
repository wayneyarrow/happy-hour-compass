/**
 * Shared venue placeholder-image selection logic.
 *
 * Single source of truth for "what image represents this venue when no
 * operator-uploaded photo exists". Previously duplicated independently
 * across five call sites (admin/venue/VenueImagesSection.tsx,
 * (consumer)/home/VenueRailCard.tsx, (consumer)/venue/[id]/page.tsx,
 * (consumer)/VenueList.tsx, (website)/[market]/[city]/[slug]/page.tsx) —
 * and had already drifted: two of the five mapped "Brewery" to a different
 * fallback image than the other three. This file is the single canonical
 * version (the majority, 3-of-5 behavior); every call site now imports from
 * here instead of keeping its own copy.
 *
 * Selection order:
 *   1. The venue's first uploaded image (operator-uploaded, via the `media`
 *      table) — unchanged from existing behavior.
 *   2. `placeholder_image_path` (venues table, migration 073) — a specific
 *      image assigned from the seeded venue image library under
 *      public/images/venues/<category>/. Not yet populated for any venue as
 *      of that migration; this tier simply never applies until assignment
 *      happens as a separate step.
 *   3. The generic establishment-type-based fallback — unchanged from
 *      existing behavior; the only path exercised until step 2 is used.
 *
 * NOTE for structured-data (JSON-LD) callers: this helper is for *display*
 * only. Do not use it to populate schema.org image facts — a stock/seeded
 * placeholder is not a fact about the specific venue. See the venue detail
 * page's buildVenueLocalBusinessNode() call, which deliberately reads raw
 * venue.images instead.
 */

export type VenueImageSource = {
  /** Operator-uploaded images, first is primary. Omit or pass [] if none. */
  images?: { url: string }[] | null;
  /** venues.placeholder_image_path — relative path under images/venues/, no leading slash. */
  placeholderImagePath?: string | null;
  /** venues.establishment_type — drives the generic fallback when neither of the above applies. */
  establishmentType?: string | null;
};

/**
 * Generic establishment-type → static placeholder mapping. This is the
 * pre-existing (pre-seeded-library) fallback, used only when the venue has
 * no uploaded images and no placeholder_image_path assigned.
 */
function getEstablishmentTypeFallbackImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery")) return "/images/casual-dining-1.jpg";
  if (t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

/**
 * Resolves the single image URL to display for a venue: uploaded photo,
 * then assigned seeded placeholder, then the generic type-based fallback.
 */
export function getVenueImageSrc(venue: VenueImageSource): string {
  if (venue.images && venue.images.length > 0) {
    return venue.images[0].url;
  }
  if (venue.placeholderImagePath) {
    return `/${venue.placeholderImagePath}`;
  }
  return getEstablishmentTypeFallbackImage(venue.establishmentType ?? "");
}
