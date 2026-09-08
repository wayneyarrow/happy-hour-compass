/**
 * Server-side Daily Specials data helper — Phase 1 data foundation.
 *
 * Mirrors the shape and conventions of src/lib/data/events.ts: uses the
 * service-role admin client (bypasses RLS — there is no authenticated
 * consumer session, same rationale as getPublishedEventsForWebsite() /
 * getPublishedVenuesForConsumer()), never throws, degrades to an empty
 * array/null on any error so a caller never hard-crashes on bad data.
 *
 * Scope (Phase 1): general-purpose venue-scoped read helpers only — no
 * market-wide consumer discovery query yet (that's later-phase work, per
 * the architecture investigation and this task's own "avoid premature
 * surface-specific code" instruction). A future Operator Admin listing page
 * is expected to query daily_specials directly through
 * resolveOperatorContext()'s ctx.supabase (RLS-respecting), the same way
 * src/app/admin/events/page.tsx queries `events` directly rather than going
 * through src/lib/data/events.ts — these helpers are for consumer/website/
 * Control Panel reads, not Operator Admin's own venue-scoped listing.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { coerceDailySpecialRow, type DailySpecial, type DailySpecialDbRow } from "@/lib/dailySpecialTypes";

const DAILY_SPECIAL_COLUMNS =
  "id, venue_id, created_by_operator_id, updated_by_operator_id, created_at, updated_at, " +
  "title, offer_type, short_summary, description, conditions, image_url, " +
  "schedule_type, one_time_date, days_of_week, recurrence_start_date, recurrence_end_date, " +
  "time_mode, start_time, end_mode, end_time, " +
  "is_published, is_seeded_special, source_url, last_verified_at";

/** Maps raw Supabase rows to coerced DailySpecial[], silently dropping any row that fails to coerce. */
function coerceRows(rows: DailySpecialDbRow[]): DailySpecial[] {
  const out: DailySpecial[] = [];
  for (const row of rows) {
    const coerced = coerceDailySpecialRow(row);
    if (coerced) out.push(coerced);
  }
  return out;
}

/**
 * Fetches Daily Specials for a single venue.
 *
 * By default returns published specials only. Pass
 * `{ includeUnpublished: true }` for a preview/authoring context (e.g. a
 * future operator preview) — callers are responsible for their own
 * authorization before requesting unpublished rows, same convention as
 * getEventForWebsiteByField()'s `includeUnpublished` option.
 *
 * Returns an empty array on any error or when the venue has none.
 */
export async function getDailySpecialsForVenue(
  venueId: string,
  options?: { includeUnpublished?: boolean }
): Promise<DailySpecial[]> {
  try {
    const supabase = createAdminClient();

    let query = supabase
      .from("daily_specials")
      .select(DAILY_SPECIAL_COLUMNS)
      .eq("venue_id", venueId)
      .order("created_at", { ascending: true });

    if (!options?.includeUnpublished) {
      query = query.eq("is_published", true);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[getDailySpecialsForVenue] Supabase error:", error);
      return [];
    }

    return coerceRows((data ?? []) as unknown as DailySpecialDbRow[]);
  } catch (err) {
    console.error("[getDailySpecialsForVenue] Unexpected error:", err);
    return [];
  }
}

/**
 * Fetches PUBLISHED Daily Specials for a single venue. Thin, clearly-named
 * entry point for a future venue-detail page (or any other consumer-facing
 * surface) that only ever wants published content and shouldn't need to
 * know about getDailySpecialsForVenue()'s preview option at all.
 */
export async function getPublishedDailySpecialsForVenue(venueId: string): Promise<DailySpecial[]> {
  return getDailySpecialsForVenue(venueId, { includeUnpublished: false });
}

/**
 * Fetches a single Daily Special by its id.
 *
 * In normal mode (default) only a published row is returned. Pass
 * `{ includeUnpublished: true }` for a preview context — mirrors
 * getEventForConsumerById()'s `includeUnpublished` option exactly. The
 * returned id is expected to remain stable for a future venue-detail-page
 * anchor (e.g. "#daily-special-<id>") — no slug exists for this content
 * type (locked product decision, see the migration header).
 *
 * Returns null on any error, or when not found under the requested mode.
 */
export async function getDailySpecialById(
  id: string,
  options?: { includeUnpublished?: boolean }
): Promise<DailySpecial | null> {
  try {
    const supabase = createAdminClient();

    let query = supabase
      .from("daily_specials")
      .select(DAILY_SPECIAL_COLUMNS)
      .eq("id", id);

    if (!options?.includeUnpublished) {
      query = query.eq("is_published", true);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("[getDailySpecialById] Supabase error:", error);
      return null;
    }
    if (!data) return null;

    return coerceDailySpecialRow(data as unknown as DailySpecialDbRow);
  } catch (err) {
    console.error("[getDailySpecialById] Unexpected error:", err);
    return null;
  }
}
