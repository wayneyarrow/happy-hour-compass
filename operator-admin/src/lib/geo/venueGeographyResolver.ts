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
import {
  GREATER_SAN_DIEGO_CITY_ALIASES,
  GREATER_SAN_DIEGO_MARKET_SLUG,
} from "./rosters/greaterSanDiego";

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

/** Lowercase + trim. The single normalization rule used for all city/province matching. */
export function normalizeGeographyText(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Known text aliases → canonical seeded city slug, scoped per market
 * (market slug → alias → city slug). An alias only ever points at a city of
 * its own market, so a generic neighbourhood name ("North Park") registered
 * for one market can never select a city in another. The BC entries were
 * ported from scripts/backfillVenueGeography.ts; Greater San Diego's live in
 * src/lib/geo/rosters/greaterSanDiego.ts. This is the one place aliases are
 * assembled.
 */
export const CITY_ALIASES_BY_MARKET: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "greater-vancouver": {
    "langley township": "langley",
    "district of west vancouver": "west-vancouver",
    "district of north vancouver": "north-vancouver",
    "city of north vancouver": "north-vancouver",
  },
  [GREATER_SAN_DIEGO_MARKET_SLUG]: GREATER_SAN_DIEGO_CITY_ALIASES,
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
  // Greater San Diego (Nov 2026). Google returns "CA"; a typed full name
  // must normalize to the same code or the veto would reject a valid match.
  california: "ca",
  ca: "ca",
};

function normalizeProvinceCode(s: string | null | undefined): string | null {
  const key = normalizeGeographyText(s);
  return key ? (PROVINCE_CODES[key] ?? key) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup construction (pure — no I/O)
// ─────────────────────────────────────────────────────────────────────────────

export type CityLookupRow = { id: string; slug: string; name: string; market_id: string };
/** `slug` is optional so callers that only know provinces (tests, the backfill script) still work. */
export type MarketProvinceRow = { id: string; province: string; slug?: string };

type CityCandidate = { cityId: string; marketId: string; canonicalName: string };

export type CityGeographyLookup = {
  /**
   * Normalized name/slug/alias → every city it can mean. Usually one; more
   * than one only when two markets share a city name (e.g. a future
   * "Richmond, CA" next to Richmond, BC), which resolveCityGeography()
   * disambiguates by province or refuses — never "last one wins".
   */
  byNormalizedName: Map<string, CityCandidate[]>;
  marketProvinceById: Map<string, string>;
};

function addCandidate(map: Map<string, CityCandidate[]>, key: string, entry: CityCandidate) {
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.some((e) => e.cityId === entry.cityId)) list.push(entry);
  map.set(key, list);
}

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
  const byNormalizedName = new Map<string, CityCandidate[]>();
  const toEntry = (c: CityLookupRow): CityCandidate => ({
    cityId: c.id,
    marketId: c.market_id,
    canonicalName: c.name,
  });

  for (const c of cities) {
    addCandidate(byNormalizedName, normalizeGeographyText(c.name), toEntry(c));
    // Also register the slug (dashes → spaces) as an alternate key.
    addCandidate(byNormalizedName, normalizeGeographyText(c.slug.replace(/-/g, " ")), toEntry(c));
  }

  // Market-scoped aliases. An alias whose key is already a real city name is
  // skipped — a seeded city always wins over an alias of the same spelling.
  // The target is the city with that slug in that market; when market slugs
  // weren't supplied (backfill script), only a slug unique across all
  // markets is accepted.
  const marketIdBySlug = new Map(markets.filter((m) => m.slug).map((m) => [m.slug as string, m.id]));
  for (const [marketSlug, aliases] of Object.entries(CITY_ALIASES_BY_MARKET)) {
    const marketId = marketIdBySlug.get(marketSlug);
    for (const [alias, targetSlug] of Object.entries(aliases)) {
      const key = normalizeGeographyText(alias);
      if (byNormalizedName.has(key)) continue;
      const targets = cities.filter(
        (c) => c.slug === targetSlug && (marketId === undefined || c.market_id === marketId)
      );
      if (targets.length === 1) addCandidate(byNormalizedName, key, toEntry(targets[0]));
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
 * City name/slug/alias is always the basis for *which* city is selected.
 * Province is a safety veto: if the caller supplies province text that
 * normalizes to a known code AND it clearly disagrees with a candidate
 * city's market province, that candidate is dropped rather than silently
 * assigning the venue to the wrong market. When two markets share a city
 * name, the veto is what leaves a single candidate; if it can't (no
 * province supplied), the result is null — never "last one wins". Omitting
 * province skips the veto — for a uniquely named city, matching then
 * depends on city text alone, identical to the original backfill
 * script's behaviour.
 */
export function resolveCityGeography(
  input: { city: string | null | undefined; province?: string | null | undefined },
  lookup: CityGeographyLookup
): GeographyResolution | null {
  const cityKey = normalizeGeographyText(input.city);
  if (!cityKey) return null;

  const candidates = lookup.byNormalizedName.get(cityKey);
  if (!candidates?.length) return null;

  // Province veto (unchanged for the single-candidate case): drop any
  // candidate whose market province clearly disagrees with the submitted one.
  const submittedProvince = normalizeProvinceCode(input.province);
  const plausible = candidates.filter((c) => {
    if (!submittedProvince) return true;
    const marketProvince = lookup.marketProvinceById.get(c.marketId);
    return !marketProvince || marketProvince === submittedProvince;
  });

  // Exactly one plausible city, or nothing — a name shared by two markets
  // with no province to tell them apart is left unassigned, never guessed.
  if (plausible.length !== 1) return null;
  const match = plausible[0];

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
      supabase.from("markets").select("id, province, slug"),
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
