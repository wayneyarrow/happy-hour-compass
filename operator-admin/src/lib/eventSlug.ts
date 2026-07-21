import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/lib/slugify";

/**
 * Event slug generation — the one authoritative algorithm for producing an
 * events.slug value. See docs/website/ event-url-architecture Phase 1 plan.
 *
 * Format: {venue.slug}-{slugify(event.title)}, e.g.
 *   "hotel-eldorado" + "Live Music Mondays" -> "hotel-eldorado-live-music-mondays"
 *
 * Rules (must not be re-derived differently by any other caller):
 *   - The venue slug is always the prefix — never omitted.
 *   - Generated once at event creation. Never regenerated automatically on
 *     title edit, venue rename, or venue slug change (see saveEventAction —
 *     the update path never touches events.slug).
 *   - If the title slugifies to an empty string, falls back to
 *     "{venue-slug}-event" rather than producing a bare/malformed slug.
 *   - Never falls back to the event's UUID.
 *   - Collision-checked against live events.slug values (see
 *     resolveUniqueEventSlug).
 *
 * PHASE 1 SCOPE NOTE: collision checking does NOT query
 * event_slug_history. That table doesn't exist until migration 069 is
 * applied, and stays empty through the end of Phase 1 regardless (the 070
 * backfill never writes to it — see that migration's header), so checking
 * it today would add a hard runtime dependency on a table that may not
 * exist yet for zero practical benefit. Once Phase 2 starts writing
 * retired slugs to event_slug_history (an explicit slug-edit feature),
 * resolveUniqueEventSlug should also check it there, the same way
 * venue slug changes are expected to.
 */

export class MissingVenueSlugError extends Error {
  constructor(venueId: string) {
    super(
      `Cannot generate an event slug: venue ${venueId} was not found or has no slug.`
    );
    this.name = "MissingVenueSlugError";
  }
}

/**
 * Number of collision-driven regeneration attempts saveEventAction (or any
 * other caller performing an insert) should make before giving up. Each
 * attempt re-reads current slug state, so a retry after a genuine unique-
 * constraint race will normally succeed on the very next attempt.
 */
export const MAX_SLUG_GENERATION_ATTEMPTS = 5;

/**
 * Computes the venue-qualified base slug for an event, deterministically
 * from venue slug + event title alone (no DB read). Exported for targeted
 * verification; production callers should use generateEventSlug, which also
 * resolves collisions.
 */
export function buildBaseEventSlug(venueSlug: string, title: string): string {
  // Real venue slugs are always already lowercase (produced by slugify()/
  // generateSlug()) — this lowercase() is defense-in-depth, not a
  // correction of expected input, so the "slugs must be lowercase"
  // requirement holds unconditionally regardless of caller input.
  const normalizedVenueSlug = (venueSlug ?? "").toLowerCase();
  const titleSlug = slugify(title ?? "");
  return titleSlug ? `${normalizedVenueSlug}-${titleSlug}` : `${normalizedVenueSlug}-event`;
}

/**
 * Resolves `base` to a slug guaranteed (at read time) not to collide with
 * any live events.slug value, using the approved deterministic sequence:
 *   1. {base}
 *   2. {base}-2
 *   3. {base}-3
 *   ...continuing numerically as required.
 *
 * Does NOT check event_slug_history — see the PHASE 1 SCOPE NOTE at the top
 * of this file for why that's deliberately deferred to Phase 2, not an
 * oversight.
 *
 * This is a read-then-decide check, not a lock — see MAX_SLUG_GENERATION_ATTEMPTS
 * and isUniqueSlugViolation for how callers must still handle a concurrent
 * insert racing this same base slug.
 */
export async function resolveUniqueEventSlug(
  supabase: SupabaseClient,
  base: string
): Promise<string> {
  const { data, error } = await supabase
    .from("events")
    .select("slug")
    .or(`slug.eq.${base},slug.like.${base}-%`);

  if (error) {
    throw new Error(`Failed to check existing event slugs: ${error.message}`);
  }

  const taken = new Set<string>();
  for (const row of (data ?? []) as { slug: string }[]) taken.add(row.slug);

  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Generates a valid, currently-unique, venue-qualified event slug for a new
 * event. Throws MissingVenueSlugError if venueId doesn't resolve to a venue
 * with a non-empty slug — event creation should fail with a controlled
 * error in that case rather than produce an unusable canonical slug (see
 * saveEventAction, which maps this to a user-facing message).
 */
export async function generateEventSlug(
  supabase: SupabaseClient,
  params: { venueId: string; title: string }
): Promise<string> {
  const { venueId, title } = params;

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .select("slug")
    .eq("id", venueId)
    .maybeSingle();

  if (venueError) {
    throw new Error(`Failed to resolve venue for slug generation: ${venueError.message}`);
  }
  const venueSlug = (venue as { slug: string | null } | null)?.slug;
  if (!venueSlug) {
    throw new MissingVenueSlugError(venueId);
  }

  const base = buildBaseEventSlug(venueSlug, title);
  return resolveUniqueEventSlug(supabase, base);
}

/**
 * True when `error` is a Postgres unique-violation (23505) on the events
 * slug constraint — the one DB-level error a slug-generation caller should
 * treat as "retry with a freshly regenerated slug" rather than a fatal,
 * user-facing failure. The UNIQUE constraint on events.slug remains the
 * final integrity safeguard; this only classifies the error so a retry loop
 * (see MAX_SLUG_GENERATION_ATTEMPTS) can react to it without ever exposing
 * the raw Postgres message to the operator.
 */
export function isUniqueSlugViolation(error: PostgrestError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "23505" && /slug/i.test(error.message ?? "");
}
