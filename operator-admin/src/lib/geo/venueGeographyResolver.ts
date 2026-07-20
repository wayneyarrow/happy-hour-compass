/**
 * Venue geography resolver — shared city/market matching primitive.
 *
 * Resolves free-text city (and optionally province) values — as submitted
 * by an operator or extracted from a Google Places match — to the seeded
 * `markets` / `cities` tables' FK pair (`market_id`, `city_id`). See
 * "Geographic Information Architecture" in
 * docs/website/WEBSITE_PRODUCT_PLAYBOOK.md for the product model this
 * implements.
 *
 * This is the single source of truth for "does this city text match a
 * seeded city" — shared by every Add Your Venue venue-INSERT path
 * (`(consumer)/suggest/owner/actions.ts`,
 * `control-panel/operator-submissions/[id]/actions.ts`) and
 * `scripts/backfillVenueGeography.ts`, so the matching rule is never
 * duplicated or allowed to drift between the live app and the repair script.
 *
 * Never fabricates or guesses: returns `null` whenever the submitted city
 * text doesn't confidently match a seeded city. Callers must handle the
 * no-match case explicitly by leaving `market_id`/`city_id` unassigned — the
 * publish-readiness gate (`src/lib/venueReadiness.ts`) then blocks
 * publication until a founder resolves it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

/** Lowercase + trim. The single normalization rule used for all city/province matching. */
export function normalizeGeographyText(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Known text aliases from legacy/submitted data → canonical seeded city slug.
 * Ported from scripts/backfillVenueGeography.ts (previously defined only
 * there) — this is now the one place these aliases live.
 */
export const CITY_ALIASES: Record<string, string> = {
  "langley township": "langley",
  "district of west vancouver": "west-vancouver",
  "district of north vancouver": "north-vancouver",
  "city of north vancouver": "north-vancouver",
};

/**
 * Known province text → normalized short code. Used only as an optional
 * safety veto in resolveCityGeography() — never to select between
 * candidate cities. Extend as new markets/provinces are seeded.
 */
const PROVINCE_CODES: Record<string, string> = {
  "british columbia": "bc",
  bc: "bc",
  alberta: "ab",
  ab: "ab",
};

function normalizeProvinceCode(s: string | null | undefined): string | null {
  const key = normalizeGeographyText(s);
  return key ? (PROVINCE_CODES[key] ?? key) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup construction (pure — no I/O)
// ─────────────────────────────────────────────────────────────────────────────

export type CityLookupRow = { id: string; slug: string; name: string; market_id: string };
export type MarketProvinceRow = { id: string; province: string };

export type CityGeographyLookup = {
  byNormalizedName: Map<string, { cityId: string; marketId: string; canonicalName: string }>;
  marketProvinceById: Map<string, string>;
};

/**
 * Builds the in-memory matching lookup from already-fetched `cities` and
 * `markets` rows. Pure function — no I/O — so it's safe to unit test and
 * reusable by both the live app and the backfill script regardless of how
 * each obtains its Supabase client.
 */
export function buildCityGeographyLookup(
  cities: CityLookupRow[],
  markets: MarketProvinceRow[]
): CityGeographyLookup {
  const byNormalizedName = new Map<
    string,
    { cityId: string; marketId: string; canonicalName: string }
  >();

  for (const c of cities) {
    const entry = { cityId: c.id, marketId: c.market_id, canonicalName: c.name };
    byNormalizedName.set(normalizeGeographyText(c.name), entry);
    // Also register the slug (dashes → spaces) as an alternate key.
    byNormalizedName.set(normalizeGeographyText(c.slug.replace(/-/g, " ")), entry);
  }

  // Explicit alias overrides win over name/slug keys.
  for (const [alias, targetSlug] of Object.entries(CITY_ALIASES)) {
    const target = cities.find((c) => c.slug === targetSlug);
    if (target) {
      byNormalizedName.set(normalizeGeographyText(alias), {
        cityId: target.id,
        marketId: target.market_id,
        canonicalName: target.name,
      });
    }
  }

  const marketProvinceById = new Map<string, string>();
  for (const m of markets) {
    const code = normalizeProvinceCode(m.province);
    if (code) marketProvinceById.set(m.id, code);
  }

  return { byNormalizedName, marketProvinceById };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching (pure — no I/O)
// ─────────────────────────────────────────────────────────────────────────────

export type GeographyResolution = {
  cityId: string;
  marketId: string;
  /** Canonical seeded city name the input matched — for logging/audit only. */
  matchedCityName: string;
};

/**
 * Matches submitted city (+ optional province) text against a pre-built
 * lookup. Pure — no I/O.
 *
 * City name/slug/alias is always the sole basis for *which* city is
 * selected — province never widens or picks between candidates (today no
 * two seeded cities share a normalized name, so there is nothing to
 * disambiguate). Province is used only as a safety veto: if the caller
 * supplies province text that normalizes to a known code AND it clearly
 * disagrees with the matched city's market province, the match is rejected
 * rather than silently assigning the venue to the wrong market. Omitting
 * province (or supplying text that doesn't normalize to a known code)
 * skips the veto entirely — matching then depends on city text alone,
 * identical to the original backfill script's behaviour.
 */
export function resolveCityGeography(
  input: { city: string | null | undefined; province?: string | null | undefined },
  lookup: CityGeographyLookup
): GeographyResolution | null {
  const cityKey = normalizeGeographyText(input.city);
  if (!cityKey) return null;

  const match = lookup.byNormalizedName.get(cityKey);
  if (!match) return null;

  const submittedProvince = normalizeProvinceCode(input.province);
  if (submittedProvince) {
    const marketProvince = lookup.marketProvinceById.get(match.marketId);
    if (marketProvince && marketProvince !== submittedProvince) return null;
  }

  return { cityId: match.cityId, marketId: match.marketId, matchedCityName: match.canonicalName };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetching (I/O — thin wrapper, works with either the app's admin client or
// a script's directly-constructed @supabase/supabase-js client)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the full seeded `cities` + `markets` population and builds the
 * matching lookup. The seeded set is small (a handful of markets/cities),
 * so one unfiltered fetch per call is intentionally simple rather than
 * cached — callers doing bulk work (e.g. the backfill script) should call
 * this once and reuse the lookup via resolveCityGeography() per row instead
 * of calling resolveVenueGeography() in a loop.
 */
export async function fetchCityGeographyLookup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
): Promise<CityGeographyLookup> {
  const [{ data: cityRows, error: cityErr }, { data: marketRows, error: marketErr }] =
    await Promise.all([
      supabase.from("cities").select("id, slug, name, market_id"),
      supabase.from("markets").select("id, province"),
    ]);

  if (cityErr) throw cityErr;
  if (marketErr) throw marketErr;

  return buildCityGeographyLookup(
    (cityRows ?? []) as CityLookupRow[],
    (marketRows ?? []) as MarketProvinceRow[]
  );
}

/**
 * Convenience one-shot resolver for a single venue creation call site:
 * fetches the lookup fresh and resolves one city/province pair. Not
 * intended for bulk use — see fetchCityGeographyLookup() doc comment.
 */
export async function resolveVenueGeography(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  input: { city: string | null | undefined; province?: string | null | undefined }
): Promise<GeographyResolution | null> {
  const lookup = await fetchCityGeographyLookup(supabase);
  return resolveCityGeography(input, lookup);
}
