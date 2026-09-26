/**
 * Daily Special click counts for Control Panel Analytics → Consumer Demand.
 *
 * Source: public.daily_special_click_events (migration 101) — one row per
 * click on a Daily Special card in the Daily Specials search results, which
 * opens that Special's venue page at its anchor. Impressions are never
 * recorded. No click history exists before this table + the instrumented
 * card were deployed (nothing captured these clicks previously), so
 * `trackingSince` is reported alongside the counts rather than implying
 * older history.
 *
 * Counts use `count: "exact", head: true` — the count is computed
 * server-side, so it is not subject to PostgREST's row-return cap.
 */

import { createAdminClient } from "@/lib/supabase/server";

export type DailySpecialClickSummary =
  | {
      available: true;
      clicksLast30d: number;
      clicksAllTime: number;
      /** clicked_at of the earliest recorded click; null when none recorded yet. */
      trackingSince: string | null;
    }
  | { available: false };

export async function getDailySpecialClickSummary(since30d: string): Promise<DailySpecialClickSummary> {
  try {
    const supabase = createAdminClient();
    const [r30, rAll, rFirst] = await Promise.all([
      supabase.from("daily_special_click_events").select("*", { count: "exact", head: true }).gte("clicked_at", since30d),
      supabase.from("daily_special_click_events").select("*", { count: "exact", head: true }),
      supabase
        .from("daily_special_click_events")
        .select("clicked_at")
        .order("clicked_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    // Most likely cause: migration 101 not yet applied. Report "unavailable"
    // rather than a misleading zero.
    if (r30.error || rAll.error || rFirst.error) {
      console.error(
        "[getDailySpecialClickSummary] query failed:",
        r30.error?.message ?? rAll.error?.message ?? rFirst.error?.message
      );
      return { available: false };
    }

    return {
      available: true,
      clicksLast30d: r30.count ?? 0,
      clicksAllTime: rAll.count ?? 0,
      trackingSince: (rFirst.data as { clicked_at?: string } | null)?.clicked_at ?? null,
    };
  } catch (err) {
    console.error("[getDailySpecialClickSummary] unexpected error:", err);
    return { available: false };
  }
}
