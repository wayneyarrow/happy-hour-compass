import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify, isReservedVenueSlug } from "@/lib/slugify";

/**
 * Public venue slug generation from the venue's public name — used by
 * founder approval of an operator submission (approveAndCreateVenueAction).
 * Never derived from a submission id, venue UUID, or Google Place ID.
 *
 * Follows migration 066's convention: the canonical URL is already
 * /{market}/{city}/{venue-slug}, so a redundant trailing city is dropped
 * ("The Placery at Hyatt Place Kelowna" in Kelowna → the-placery-at-hyatt-place).
 *
 * A candidate is available only if it is not a current venues.slug, not a
 * retired venue_slug_history.old_slug (so a new venue can never take over an
 * old redirect URL), and not reserved (RESERVED_VENUE_SLUGS). Deterministic
 * order — never random:
 *   1. {base}
 *   2. {base}-{city}   (location qualifier, as 066 did for Original Joe's)
 *   3. {base}-2, {base}-3, …
 *
 * Read-then-decide, not a lock: the venues.slug UNIQUE constraint (23505)
 * remains the concurrency backstop at insert time.
 *
 * Other venue-creation flows (Add Your Venue auto-match, operator "add
 * another venue", seeds) still use their own slug logic — out of scope here.
 */

const MAX_BASE_LENGTH = 80;
const FALLBACK_BASE = "venue";

/**
 * Words that, directly before the city, make it part of a different place
 * name ("… West Kelowna", "… Downtown Kelowna") — the trailing city is then
 * not redundant and is kept.
 */
const GEOGRAPHIC_MODIFIERS: ReadonlySet<string> = new Set([
  "west", "east", "north", "south", "downtown", "upper", "lower", "lake", "greater", "old", "new",
]);

/**
 * slugify(name) (apostrophes dropped), minus a redundant trailing city. The city is only stripped
 * when it is the exact trailing token sequence, at least two tokens remain,
 * and the preceding token isn't a geographic modifier — so a name like
 * "Hotel Kelowna" or "Bar West Kelowna" keeps its city words.
 */
export function buildBaseVenueSlug(name: string, cityName?: string | null): string {
  // Apostrophes are dropped, not hyphenated — matches 066's curated slugs
  // (original-joes, kelly-obryans, oflannigans-pub), not "original-joe-s".
  let base = slugify((name ?? "").replace(/['’]/g, ""));
  const citySlug = slugify(cityName ?? "");

  if (citySlug && base.endsWith(`-${citySlug}`)) {
    const remainder = base.slice(0, -(citySlug.length + 1));
    const tokens = remainder.split("-");
    if (tokens.length >= 2 && !GEOGRAPHIC_MODIFIERS.has(tokens[tokens.length - 1])) {
      base = remainder;
    }
  }

  base = base.slice(0, MAX_BASE_LENGTH).replace(/-+$/, "");
  return base || FALLBACK_BASE;
}

/**
 * Picks the first available candidate in the documented order. Pure — `taken`
 * is every current and historical slug equal to base or starting with
 * "{base}-".
 */
export function pickAvailableVenueSlug(
  base: string,
  cityName: string | null | undefined,
  taken: ReadonlySet<string>
): string {
  const isFree = (slug: string) => !taken.has(slug) && !isReservedVenueSlug(slug);

  if (isFree(base)) return base;

  const citySlug = slugify(cityName ?? "");
  if (citySlug && !base.endsWith(`-${citySlug}`)) {
    const withCity = `${base}-${citySlug}`;
    if (isFree(withCity)) return withCity;
  }

  let n = 2;
  while (!isFree(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Generates an available public venue slug for a new venue. Throws if
 * either availability lookup fails — a slug that couldn't be checked against
 * current and historical slugs must never be used.
 */
export async function resolveAvailableVenueSlug(
  supabase: SupabaseClient,
  params: { name: string; cityName?: string | null }
): Promise<string> {
  const base = buildBaseVenueSlug(params.name, params.cityName);
  const filter = `slug.eq.${base},slug.like.${base}-%`;

  const [current, historical] = await Promise.all([
    supabase.from("venues").select("slug").or(filter),
    supabase
      .from("venue_slug_history")
      .select("old_slug")
      .or(`old_slug.eq.${base},old_slug.like.${base}-%`),
  ]);

  if (current.error) {
    throw new Error(`Failed to check existing venue slugs: ${current.error.message}`);
  }
  if (historical.error) {
    throw new Error(`Failed to check historical venue slugs: ${historical.error.message}`);
  }

  const taken = new Set<string>();
  for (const row of (current.data ?? []) as { slug: string }[]) taken.add(row.slug);
  for (const row of (historical.data ?? []) as { old_slug: string }[]) taken.add(row.old_slug);

  return pickAvailableVenueSlug(base, params.cityName, taken);
}
