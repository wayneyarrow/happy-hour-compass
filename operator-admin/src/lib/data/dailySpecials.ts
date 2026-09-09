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
import {
  coerceDailySpecialRow,
  coerceDailySpecialSchedule,
  coerceDailySpecialTime,
  isOfferType,
  type DailySpecial,
  type DailySpecialDbRow,
} from "@/lib/dailySpecialTypes";
import { haversineKm } from "@/lib/discover/discoverEngine";
import { toMarketConfig, type Market } from "@/lib/markets";

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

// ─────────────────────────────────────────────────────────────────────────────
// Website Daily Specials Search (Phase 3 — consumer discovery)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daily Special shape for the public website search/results page. Includes
 * enough venue context to render a card and link to the venue detail page
 * — never a standalone Daily Special page (locked product decision, no
 * slug/detail route exists for this content type).
 *
 * Venue image fields mirror ConsumerVenue's list-fetch convention
 * (getPublishedVenuesForConsumer): no per-row `media` table join here — a
 * market-wide list avoids that N+1 query the same way venue/event list
 * fetches already do, falling back to placeholderImagePath/establishmentType
 * via getVenueImageSrc() rather than a real uploaded venue photo.
 */
export type WebsiteDailySpecialListItem = {
  id: string;
  title: string;
  offerType: string;
  shortSummary: string | null;
  description: string | null;
  conditions: string | null;
  imageUrl: string | null;
  schedule: DailySpecial["schedule"];
  time: DailySpecial["time"];
  venueId: string;
  venueName: string;
  /** Venue slug — used as the routing segment via buildVenuePublicPath (ConsumerVenue.id's own convention: the "slug" is stored under venues.slug, not a separate column). */
  venueSlug: string;
  venueEstablishmentType: string;
  venuePlaceholderImagePath: string | null;
  venueLat: number | null;
  venueLng: number | null;
  /** Canonical market slug for this venue's public URL. Null if unresolved — see buildVenuePublicPath. */
  marketSlug: string | null;
  /** Canonical city slug for this venue's public URL. Null if unresolved — see buildVenuePublicPath. */
  citySlug: string | null;
};

/**
 * Fetches published Daily Specials for the website Daily Specials search
 * page, scoped to the active market (same Haversine-distance pattern as
 * getPublishedEventsForWebsite() / getPublishedEventsForConsumer()).
 *
 * Eligibility (locked product decision — see the Phase 3 task brief):
 *   - daily_specials.is_published = true
 *   - venues.is_published = true (venues!inner join — a Daily Special
 *     belonging to an unpublished/ineligible venue is never returned, even
 *     though the parallel Events website query does not enforce this same
 *     rule today — Events' behavior is a pre-existing, out-of-scope gap,
 *     not a pattern to copy here; Daily Specials' own product requirement
 *     is explicit and applies regardless).
 *   - Expired one-time Specials and day/date-schedule eligibility are NOT
 *     filtered here — that's date-dependent (WHEN filter, "today") and
 *     belongs in the pure occurrence helpers (src/lib/dailySpecialSchedule.ts)
 *     the client-side results page composes against this list, mirroring
 *     how Events' equivalent date filtering also happens client-side in
 *     EventSearchResults.tsx rather than in the server query.
 *
 * Returns an empty array on any error.
 */
export async function getPublishedDailySpecialsForWebsite(
  market: Market
): Promise<WebsiteDailySpecialListItem[]> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("daily_specials")
      .select(
        "id, title, offer_type, short_summary, description, conditions, image_url, " +
          "schedule_type, one_time_date, days_of_week, recurrence_start_date, recurrence_end_date, " +
          "time_mode, start_time, end_mode, end_time, " +
          "venue_id, " +
          "venues!inner(name, slug, lat, lng, establishment_type, placeholder_image_path, is_published, " +
          "market_geo:markets!market_id(slug), city_geo:cities!city_id(slug))"
      )
      .eq("is_published", true)
      .eq("venues.is_published", true)
      .order("title", { ascending: true });

    if (error) {
      console.error("[getPublishedDailySpecialsForWebsite] Supabase error:", error);
      return [];
    }

    const { lat: mLat, lng: mLng, radiusKm } = toMarketConfig(market);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).flatMap((row: Record<string, any>) => {
      if (!isOfferType(row.offer_type)) return [];

      const schedule = coerceDailySpecialSchedule({
        schedule_type: row.schedule_type,
        one_time_date: row.one_time_date,
        days_of_week: row.days_of_week,
        recurrence_start_date: row.recurrence_start_date,
        recurrence_end_date: row.recurrence_end_date,
      });
      if (!schedule) return [];

      const time = coerceDailySpecialTime({
        time_mode: row.time_mode,
        start_time: row.start_time,
        end_mode: row.end_mode,
        end_time: row.end_time,
      });
      if (!time) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const venue = (row.venues as Record<string, any> | null) ?? {};
      const vLat = typeof venue.lat === "number" ? venue.lat : null;
      const vLng = typeof venue.lng === "number" ? venue.lng : null;

      // Market filter — same permissive-for-missing-coordinates convention
      // as getPublishedEventsForWebsite().
      const hasRealCoordinates =
        vLat !== null && vLng !== null && !(vLat === 0 && vLng === 0);
      if (hasRealCoordinates && haversineKm(mLat, mLng, vLat!, vLng!) > radiusKm) {
        return [];
      }

      return [{
        id: row.id as string,
        title: (row.title as string) ?? "",
        offerType: row.offer_type as string,
        shortSummary: (row.short_summary as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        conditions: (row.conditions as string | null) ?? null,
        imageUrl: (row.image_url as string | null) ?? null,
        schedule,
        time,
        venueId: row.venue_id as string,
        venueName: (venue.name as string) ?? "",
        venueSlug: (venue.slug as string) ?? "",
        venueEstablishmentType: (venue.establishment_type as string) ?? "",
        venuePlaceholderImagePath: (venue.placeholder_image_path as string | null) ?? null,
        venueLat: vLat,
        venueLng: vLng,
        marketSlug: (venue.market_geo as { slug?: string } | null)?.slug ?? null,
        citySlug: (venue.city_geo as { slug?: string } | null)?.slug ?? null,
      }];
    });
  } catch (err) {
    console.error("[getPublishedDailySpecialsForWebsite] Unexpected error:", err);
    return [];
  }
}
