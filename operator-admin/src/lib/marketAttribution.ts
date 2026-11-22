/**
 * Market attribution for Control Panel records that have no market of their
 * own. Pure — no I/O — so Submissions and the Venue Funnel attribute
 * submissions identically and it is unit-testable.
 *
 * Submissions:
 *   - linked to a venue  → that venue's market_id. A linked venue with no
 *                          market is Unassigned; the venue is the source of
 *                          truth, and text is never used to override it.
 *   - not linked         → the submitted city/province text through the
 *                          existing geography resolver
 *                          (src/lib/geo/venueGeographyResolver.ts, the same
 *                          rule used to assign a venue's market at approval),
 *                          flagged `inferred`. A non-match or an ambiguous
 *                          match is Unassigned — never guessed.
 */

import { resolveCityGeography, type CityGeographyLookup } from "@/lib/geo/venueGeographyResolver";

export type SubmissionMarketInput = {
  venueId: string | null;
  /** The linked venue's market_id (ignored when venueId is null). */
  venueMarketId: string | null;
  city: string | null;
  province: string | null;
};

export type AttributedMarket = { marketId: string | null; inferred: boolean };

export function attributeSubmissionMarket(
  input: SubmissionMarketInput,
  lookup: CityGeographyLookup
): AttributedMarket {
  if (input.venueId) return { marketId: input.venueMarketId ?? null, inferred: false };
  const match = resolveCityGeography({ city: input.city, province: input.province }, lookup);
  return match ? { marketId: match.marketId, inferred: true } : { marketId: null, inferred: false };
}
