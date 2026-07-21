/**
 * Converts a string into a URL-safe slug.
 * e.g. "Tuesday Trivia Night!" → "tuesday-trivia-night"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Venue slugs reserved for future static route segments. A venue must never
 * be assigned one of these values — it would permanently shadow that static
 * segment (e.g. a venue slugged "events" would collide with the planned
 * canonical event route /{market}/{city}/events/{event-slug}, since Next.js
 * resolves a static path segment before a sibling dynamic one).
 *
 * This is the one central list — add future reserved words here rather than
 * creating a second reserved-word system elsewhere.
 */
export const RESERVED_VENUE_SLUGS: ReadonlySet<string> = new Set(["events"]);

/** True if `slug` (case-insensitive) is reserved and must not be used for a venue. */
export function isReservedVenueSlug(slug: string): boolean {
  return RESERVED_VENUE_SLUGS.has(slug.toLowerCase());
}
