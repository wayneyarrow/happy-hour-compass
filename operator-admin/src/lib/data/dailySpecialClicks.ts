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
import { ALL_MARKETS_SCOPE, type DashboardMarketScope } from "@/lib/dashboardMarketScope";

export type DailySpecialClickSummary =
  | {
      available: true;
      clicksLast30d: number;
      clicksAllTime: number;
      /**
       * clicked_at of the earliest recorded click on the whole platform; null
       * when none recorded yet. Never market-scoped: it marks when tracking
       * began, not when a market's first click happened.
       */
      trackingSince: string | null;
    }
  | { available: false };

/**
 * @param scope Market scope (Platform Analytics ?market=). A market or
 *              Unassigned counts clicks by the clicked venue's CURRENT
 *              market (inner join to venues on venue_id, still an exact
 *              server-side count). All markets keeps the original queries.
 */
export async function getDailySpecialClickSummary(
  since30d: string,
  scope: DashboardMarketScope = ALL_MARKETS_SCOPE
): Promise<DailySpecialClickSummary> {
  try {
    const supabase = createAdminClient();
    const clickCount = () => {
      if (scope.kind === "all") {
        return supabase.from("daily_special_click_events").select("*", { count: "exact", head: true });
      }
      const q = supabase
        .from("daily_special_click_events")
        .select("venue_id, venues!inner(market_id)", { count: "exact", head: true });
      return scope.kind === "market" ? q.eq("venues.market_id", scope.marketId) : q.is("venues.market_id", null);
    };
    const [r30, rAll, rFirst] = await Promise.all([
      clickCount().gte("clicked_at", since30d),
      clickCount(),
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
