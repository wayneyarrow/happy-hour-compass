/**
 * Page-specific venue LocalBusiness JSON-LD (Structured Data — Venue task;
 * see docs/website/ structured data strategy/architecture reviews).
 *
 * Represents the listed hospitality business itself — a LocalBusiness
 * subtype, never the Happy Hour Compass Organization. This node does not
 * reference the sitewide Organization/WebSite nodes (no publisher, no
 * parentOrganization/owner/branchOf) — a listed venue is not a Happy Hour
 * Compass brand extension, and Google's LocalBusiness model doesn't
 * require that relationship for a directory listing to be valid.
 *
 * Governing rule: never mark up a fact this data model cannot stand behind
 * at scale. Every property below is included only when the already-loaded
 * venue data makes it unambiguous — see each helper's own comment for the
 * specific reasoning. Two properties the task asked to consider are
 * deliberately absent from this file entirely, not just conditionally
 * omitted:
 *
 *   - servesCuisine: there is no explicit cuisine/category field on venues
 *     — only establishmentType (business type, not cuisine) and
 *     searchTags/seededTags, which the task explicitly rules out as a
 *     servesCuisine source. No reliable field exists at all, so there is
 *     nothing here to conditionally include.
 *   - priceRange: no price_range column (or equivalent) exists anywhere in
 *     the venues data model. Same conclusion — nothing to include.
 *
 * openingHoursSpecification is also omitted, for a reason worth stating
 * plainly rather than assuming: venues.business_hours IS reliable,
 * structured, 24-hour open/close data, clearly distinct from happy-hour
 * (hh_times) and event schedules — but by the time it reaches
 * ConsumerVenue.hoursWeekly (src/lib/data/venues.ts's mapBusinessHours()),
 * it has already been converted into a human display string ("9:00 AM -
 * 5:00 PM" / "CLOSED") and the raw 24-hour values are discarded before
 * they reach this page. Re-parsing that display string back into 24-hour
 * time inside a schema builder would mean reimplementing fragile,
 * duplicate parsing logic that doesn't exist for this purpose today.
 * Exposing the raw hours would instead mean changing the shared
 * ConsumerVenue type / rowToConsumerVenue() mapping in src/lib/data/
 * venues.ts — a real change to shared, widely-used data-loading code, not
 * something this task's scope covers silently. Flagging this rather than
 * either guessing from formatted text or broadening scope unannounced;
 * omitting openingHoursSpecification here is the correct, conservative
 * choice until that's addressed as its own deliberate change.
 */

import { absoluteUrl } from "@/lib/siteUrl";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { entityId } from "./ids";
import { toSchemaImage } from "./image";
import type { SchemaNode } from "./types";

export type VenueSchemaInput = {
  name: string;
  /** Operator-selected establishment type, e.g. "Pub", "Cocktail Bar" — see mapEstablishmentTypeToSchemaType(). */
  establishmentType: string;
  marketSlug: string | null;
  citySlug: string | null;
  /** The venue's routing slug — ConsumerVenue.id (NOT venueUuid; that field is the raw database UUID and must never be used as schema identity). */
  slug: string;
  address: string;
  city: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  images: { url: string }[];
  /** Operator-authored editorial description (ConsumerVenue.aboutYourVenue) — the one field the public page itself treats as "the venue's description," not the happy-hour tagline. */
  aboutYourVenue: string | null;
};

/**
 * Conservative allowlist from the operator-facing establishment-type
 * catalog (ESTABLISHMENT_TYPE_OPTIONS, src/app/admin/venue/types.ts) to
 * schema.org LocalBusiness/FoodEstablishment subtypes. Deliberately
 * data-driven against that same 17-value catalog rather than guessed from
 * venue name/description/menu text.
 *
 * Only maps to the subtypes this task named as examples (Restaurant,
 * BarOrPub, CafeOrCoffeeShop) — FastFoodRestaurant and Bakery have no
 * matching catalog value today, so nothing maps to them, and no catalog
 * value is stretched to fit them speculatively. "Brewery", "Winery", and
 * "Taproom" are real establishment-type options but don't clearly map onto
 * any of Restaurant/BarOrPub/CafeOrCoffeeShop — schema.org has dedicated
 * Brewery/Winery types, but this task's allowed target set doesn't include
 * them, so those three (plus "Other" and any unrecognized/future value —
 * the venues.establishment_type column has no DB-level CHECK constraint)
 * fall back to the generic FoodEstablishment type below, which is always
 * a valid, safe description of a food-and-drink venue.
 */
const ESTABLISHMENT_TYPE_SCHEMA_MAP: Record<string, string> = {
  "Fast Casual": "Restaurant",
  "Pub": "BarOrPub",
  "Bar": "BarOrPub",
  "Cocktail Bar": "BarOrPub",
  "Wine Bar": "BarOrPub",
  "Lounge": "BarOrPub",
  "Sports Bar": "BarOrPub",
  "Cafe": "CafeOrCoffeeShop",
  "Bistro": "Restaurant",
  "Restaurant and Bar": "Restaurant",
  "Casual Dining": "Restaurant",
  "Fine Dining": "Restaurant",
  "Family Dining": "Restaurant",
};

const FALLBACK_SCHEMA_TYPE = "FoodEstablishment";

function mapEstablishmentTypeToSchemaType(establishmentType: string): string {
  return ESTABLISHMENT_TYPE_SCHEMA_MAP[establishmentType] ?? FALLBACK_SCHEMA_TYPE;
}

/**
 * Builds a PostalAddress from whatever address fields are actually
 * available. venues.address_line1 (→ streetAddress) and venues.city (→
 * addressLocality) are the only address components the venue page's own
 * data-loading path (getVenueWithEventsForConsumerById) selects — region,
 * postalCode, and country columns exist on the venues table but are not
 * fetched by that query today, so they are not available here to include,
 * not merely "chosen to be omitted." A 2-field PostalAddress is still
 * useful, reliable, partial data — not "too incomplete to interpret" —
 * so it is included with only the fields that exist, per the task's own
 * partial-address guidance, rather than omitted outright.
 */
function buildAddress(streetAddress: string, locality: string): SchemaNode | undefined {
  const street = streetAddress.trim();
  const city = locality.trim();
  if (!street && !city) return undefined;
  return {
    "@type": "PostalAddress",
    ...(street && { streetAddress: street }),
    ...(city && { addressLocality: city }),
  };
}

/** GeoCoordinates only when both values are present, numeric, and finite — never partial coordinates. */
function buildGeo(latitude: number | null, longitude: number | null): SchemaNode | undefined {
  if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { "@type": "GeoCoordinates", latitude, longitude };
}

/**
 * Builds the page-specific venue LocalBusiness node, or null when the
 * minimum required identity can't be established — no canonical URL (the
 * same condition under which the venue page itself 404s or redirects) or
 * no non-empty public name. Every optional property is included only when
 * its underlying value is present and non-empty; there is no path that
 * serializes a guessed, placeholder, or empty value.
 */
export function buildVenueLocalBusinessNode(input: VenueSchemaInput): SchemaNode | null {
  const canonicalPath = buildVenuePublicPath({
    marketSlug: input.marketSlug,
    citySlug: input.citySlug,
    slug: input.slug,
  });
  if (!canonicalPath) return null;

  const name = input.name.trim();
  if (!name) return null;

  const image = toSchemaImage(input.images[0]?.url);
  const description = input.aboutYourVenue?.trim() || undefined;
  const address = buildAddress(input.address, input.city);
  const telephone = input.phone.trim() || undefined;
  const geo = buildGeo(input.latitude, input.longitude);

  return {
    "@type": mapEstablishmentTypeToSchemaType(input.establishmentType),
    "@id": entityId(canonicalPath, "localbusiness"),
    name,
    url: absoluteUrl(canonicalPath),
    ...(image && { image }),
    ...(description && { description }),
    ...(address && { address }),
    ...(telephone && { telephone }),
    ...(geo && { geo }),
  };
}
