/**
 * Product-usage row loaders for the Scout report (server-only, read-only).
 *
 * Each loader keeps the EXACT counting predicate of the established reader
 * and only adds an explicit half-open window [start, end) on the same
 * timestamp column. Nothing here changes those readers or their callers.
 *
 *   venue views   venue_view_events · viewed_at — COUNTED_VIEW_ENVIRONMENT_FILTER
 *                 (legacy NULL + production), as getOperatorAnalyticsV2() and
 *                 the venue_view_counts() RPC (migration 111). No QA exclusion.
 *   event views   event_view_events · viewed_at — same rule as above.
 *   Daily Special clicks  daily_special_click_events · clicked_at — no
 *                 environment filter, as getDailySpecialClickSummary().
 *   intent        venue_click_events · clicked_at, per click_type — no
 *                 environment column exists, as getOperatorAnalyticsV2().
 *   saves         venue_save_events · saved_at, action = 'save' — no
 *                 environment column, as getOperatorAnalyticsV2().
 *
 * Rows are read through the Search & Discovery report's fetchAllRows():
 * exact count, a 150k-row ceiling and a verified complete read — a failure
 * or a too-large range throws, it never returns partial rows.
 */

import type { createAdminClient } from "@/lib/supabase/server";
import { COUNTED_VIEW_ENVIRONMENT_FILTER } from "@/lib/analyticsEnvironment";
import { fetchAllRows } from "@/lib/data/searchDiscoveryReport";
import type { ReportWindow } from "./windows";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;
type Win = Pick<ReportWindow, "startUtc" | "endUtc">;

export type VenueViewRow = { id: string; venue_id: string; environment: string | null };
export type EventViewRow = { id: string; event_id: string; environment: string | null };
export type DailySpecialClickRow = { id: string; daily_special_id: string; venue_id: string; source: string; environment: string | null };
export type IntentRow = { id: string; venue_id: string; click_type: string };
export type SaveRow = { id: string; venue_id: string };

const inWindow = (col: string, w: Win) => (q: Query) => q.gte(col, w.startUtc).lt(col, w.endUtc);

/** The established view predicate: legacy (NULL) + production rows. */
export const countedViews = (q: Query) => q.or(COUNTED_VIEW_ENVIRONMENT_FILTER);
/** Rows the established view rule does NOT count (labelled staging / preview / development). */
export const notCountedViews = (q: Query) => q.not("environment", "is", null).neq("environment", "production");

export function loadVenueViewRows(admin: Admin, w: Win): Promise<VenueViewRow[]> {
  return fetchAllRows<VenueViewRow>(admin, "venue_view_events", "id, venue_id, environment", (q) => inWindow("viewed_at", w)(countedViews(q)), ["viewed_at", "id"]);
}

export function loadEventViewRows(admin: Admin, w: Win): Promise<EventViewRow[]> {
  return fetchAllRows<EventViewRow>(admin, "event_view_events", "id, event_id, environment", (q) => inWindow("viewed_at", w)(countedViews(q)), ["viewed_at", "id"]);
}

export function loadDailySpecialClickRows(admin: Admin, w: Win): Promise<DailySpecialClickRow[]> {
  return fetchAllRows<DailySpecialClickRow>(
    admin,
    "daily_special_click_events",
    "id, daily_special_id, venue_id, source, environment",
    (q) => inWindow("clicked_at", w)(q),
    ["clicked_at", "id"]
  );
}

export function loadIntentRows(admin: Admin, w: Win): Promise<IntentRow[]> {
  return fetchAllRows<IntentRow>(admin, "venue_click_events", "id, venue_id, click_type", (q) => inWindow("clicked_at", w)(q), ["clicked_at", "id"]);
}

export function loadSaveRows(admin: Admin, w: Win): Promise<SaveRow[]> {
  return fetchAllRows<SaveRow>(admin, "venue_save_events", "id, venue_id", (q) => inWindow("saved_at", w)(q.eq("action", "save")), ["saved_at", "id"]);
}

/** Informational: view rows in the window that the established rule excludes. Exact head count; throws on failure. */
export async function countNotCountedViewRows(admin: Admin, table: "venue_view_events" | "event_view_events", w: Win): Promise<number> {
  const res = await inWindow("viewed_at", w)(notCountedViews(admin.from(table).select("*", { count: "exact", head: true })));
  if (res.error) throw new Error(`${table} excluded-row count failed: ${res.error.message}`);
  return (res.count ?? 0) as number;
}

/** Earliest value of `col` matching `filter`, or null when there are no rows. Throws on failure. */
export async function firstRowAt(admin: Admin, table: string, col: string, filter: (q: Query) => Query = (q) => q): Promise<string | null> {
  const res = await filter(admin.from(table).select(col)).order(col, { ascending: true }).limit(1).maybeSingle();
  if (res.error) throw new Error(`${table} first-row lookup failed: ${res.error.message}`);
  return ((res.data as Record<string, string> | null)?.[col] as string | undefined) ?? null;
}
