/**
 * Feature Adoption — durable operator engagement signal for Daily Specials
 * and Events, for a single venue.
 *
 * CORRECTED DESIGN (see supabase/migrations/096_venue_feature_adoption.sql
 * header for the full investigation): the original version of this module
 * recorded adoption via AFTER INSERT/UPDATE database triggers that judged
 * engagement purely from persisted created_by_operator_id/updated_by_operator_id
 * values. That was unsafe — those columns are stamped identically whether a
 * write came from a genuine operator session OR from founder/support acting
 * through "Open as Operator" (Case A impersonation resolves the SAME real
 * operators.id ctx.operator would resolve for that operator's own login —
 * see src/lib/impersonation.ts). A trigger inspecting only the row's stored
 * columns cannot tell those two cases apart, so it cannot enforce the locked
 * rule that impersonation must never count as adoption.
 *
 * The corrected design (Rev 3 — see migration 096 header for the full
 * revision history) has two parts:
 *
 *   1. CONTENT-LEVEL PROVENANCE (events.is_genuine_operator_engaged /
 *      daily_specials.is_genuine_operator_engaged) is set by
 *      saveEventAction()/saveDailySpecialAction(), in the SAME statement as
 *      the actual content write, via genuineOperatorFieldPatch(ctx) — never
 *      inferred later from created_by_operator_id/updated_by_operator_id,
 *      which cannot distinguish impersonation. Monotonic (set-only-to-TRUE):
 *      a later admin/impersonation edit can neither grant nor revoke it.
 *
 *   2. VENUE-LEVEL DURABLE ADOPTION (public.venue_feature_adoption) is
 *      written two ways, both funneling through the same idempotent
 *      record_feature_adoption() SQL upsert:
 *        a. FIRST adoption: a database trigger
 *           (events_first_adoption_trigger()/daily_specials_first_adoption_trigger(),
 *           migration 096) reacts to is_genuine_operator_engaged
 *           transitioning FALSE→TRUE (or being TRUE at INSERT), writing
 *           venue_feature_adoption in the SAME transaction as the content
 *           write. This closes a gap in an earlier revision, where a
 *           separate post-save RPC call was the ONLY path to durable
 *           adoption — if that RPC failed, content could save while
 *           adoption was silently lost. It cannot recur now: if the content
 *           write commits, the trigger's write commits with it.
 *        b. SUBSEQUENT engagement: recordFeatureAdoption() below, called
 *           from the same two server actions after every genuine save,
 *           advances last_engaged_at for repeat genuine edits (the trigger
 *           only fires once, on the first FALSE→TRUE transition). A failure
 *           here can only leave last_engaged_at stale — it cannot revert
 *           adoption or produce a false Red X, since adoption itself is
 *           already durable by the time this runs.
 *
 * "Active count" is computed live, at read time, from current rows only.
 * Events: is_published = true AND is_genuine_operator_engaged = true,
 * evaluated with upcomingBucket() (not past). Daily Specials (corrected
 * 2026-09 — previously "occurs today" against a UTC date, which is why a
 * venue with only future one-time Specials showed "✓ Specials 0"):
 * operator-created, published, current-or-upcoming Specials against the
 * venue's market-local date — see dailySpecialAdoptionCounts.ts, shared
 * with the Action Center Specials Adoption report.
 *
 * Deliberately independent of VenueHealthData/venueHealth.ts so this module
 * can move into a future, permanent Customer Success section without
 * dragging Health Panel internals along.
 *
 * KNOWN LIMITATIONS (see migration 096's BACKFILL section for the full
 * audit results and policy):
 *   - Content hard-deleted before this correction existed, with no other
 *     qualifying evidence ever recorded, cannot be reconstructed.
 *   - A historical row IS backfilled into venue_feature_adoption /
 *     is_genuine_operator_engaged when, and only when, it has real operator
 *     attribution AND its evidence timestamp does not overlap any
 *     operator_impersonation_sessions window for that same venue (a
 *     read-only production audit found 14 such rows, zero ambiguous or
 *     proven-impersonation ones). A row that cannot clear that bar is left
 *     unadopted rather than guessed — this can understate true historical
 *     adoption but never fabricates it.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { upcomingBucket } from "@/lib/data/events";
import { coerceDailySpecialSchedule } from "@/lib/dailySpecialTypes";
import { occursOnDate } from "@/lib/dailySpecialSchedule";
import { getMarketLocalIsoDate } from "@/lib/marketLocalDate";
import {
  countDailySpecialsForAdoption,
  DAILY_SPECIAL_COUNT_COLUMNS,
  IMPERSONATION_WINDOW_COLUMNS,
  toImpersonationWindow,
  type ImpersonationWindow,
  type DailySpecialAdoptionCounts,
  type DailySpecialCountRow,
} from "./dailySpecialAdoptionCounts";

// ── Public types ────────────────────────────────────────────────────────────

export type FeatureAdoptionFeature = "daily_specials" | "events";

export type FeatureAdoptionStatus = {
  adopted: boolean;
  activeCount: number;
};

export type VenueFeatureAdoption = {
  /**
   * Daily Specials. `adopted` = durable Feature Adoption (unchanged
   * definition). `activeCount` = operator-created Daily Specials that are
   * published and current or upcoming — see dailySpecialAdoptionCounts.ts,
   * the same rule the Action Center Specials Adoption report uses.
   */
  specials: FeatureAdoptionStatus;
  /** Full Daily Specials breakdown (operator-created vs platform/seeded). */
  dailySpecialCounts: DailySpecialAdoptionCounts;
  events: FeatureAdoptionStatus;
};

/**
 * Result envelope, not just VenueFeatureAdoption directly: a query failure
 * must never be silently reported as "not adopted" (a false Red X is worse
 * than no card at all). Callers must check `ok` and render a neutral/omitted
 * state on `false` — never fall back to `{ adopted: false, activeCount: 0 }`.
 */
export type VenueFeatureAdoptionResult =
  | { ok: true; data: VenueFeatureAdoption }
  | { ok: false; error: string };

/**
 * The minimal trusted operator-context shape recordFeatureAdoption() needs.
 * Deliberately narrower than impersonation.ts's full OperatorContext (no
 * import dependency on that module) — every field here must come from a
 * fresh, server-side resolveOperatorContext() call in the SAME request,
 * never from a client-supplied payload. Callers already have both fields on
 * hand from their own `ctx` after calling resolveOperatorContext().
 */
export type GenuineOperatorContext = {
  isImpersonating: boolean;
  operator: { id: string } | null;
};

/**
 * The field to spread into an events/daily_specials insert or update payload
 * to set content-level provenance. Shared by saveEventAction() and
 * saveDailySpecialAction() so this decision exists in exactly one place
 * rather than being reimplemented per action.
 *
 * Returns `{ is_genuine_operator_engaged: true }` only for a genuine
 * context — never `{ is_genuine_operator_engaged: false }`. An empty object
 * for a non-genuine context means the caller's spread (`...patch`) omits the
 * key entirely, leaving an existing column value untouched on UPDATE (the
 * monotonic set-only-to-TRUE guarantee — see migration 096) and leaving it
 * at its schema DEFAULT FALSE on INSERT.
 */
export function genuineOperatorFieldPatch(
  ctx: GenuineOperatorContext
): { is_genuine_operator_engaged: true } | Record<string, never> {
  return isGenuineOperatorContext(ctx) ? { is_genuine_operator_engaged: true } : {};
}

/** True only for a genuine, non-impersonated operator/member session. */
export function isGenuineOperatorContext(ctx: GenuineOperatorContext): boolean {
  return !ctx.isImpersonating && ctx.operator != null;
}

// ── Row shapes for active-count computation ─────────────────────────────────
// Only the columns each computation needs — no full row fetch merely to
// count. is_genuine_operator_engaged is the sole engagement signal now (see
// module header); created_by/updated_by/is_seeded are no longer read here.

export type DailySpecialActiveRow = {
  schedule_type: string;
  one_time_date: string | null;
  days_of_week: number[] | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  is_genuine_operator_engaged: boolean;
};

export type EventActiveRow = {
  first_date: string | null;
  recurrence: string | null;
  is_genuine_operator_engaged: boolean;
};

// ── Active count computation ────────────────────────────────────────────────

/**
 * "Occurs today" count. No longer used by getVenueFeatureAdoption() (see the
 * module header) — retained for its existing tests/callers only.
 */
export function countActiveDailySpecials(rows: DailySpecialActiveRow[], todayIso: string): number {
  let count = 0;
  for (const row of rows) {
    if (!row.is_genuine_operator_engaged) continue;
    const schedule = coerceDailySpecialSchedule(row);
    if (!schedule) continue;
    if (occursOnDate(schedule, todayIso)) count++;
  }
  return count;
}

/**
 * bucket !== 1 (i.e. upcoming(0) or undated(2)) is treated as "active" —
 * the exact predicate getCPFeaturedEventCandidates() already uses
 * (src/lib/data/events.ts) to mean "not past." Reused verbatim.
 */
export function countActiveEvents(rows: EventActiveRow[], todayIso: string): number {
  let count = 0;
  for (const row of rows) {
    if (!row.is_genuine_operator_engaged) continue;
    if (upcomingBucket(row.first_date, row.recurrence, todayIso) !== 1) count++;
  }
  return count;
}

// ── Recording (write side) ──────────────────────────────────────────────────

/**
 * Pure model of the SQL first-adoption trigger's firing decision
 * (events_first_adoption_trigger() / daily_specials_first_adoption_trigger(),
 * migration 096). NOT executed in production — the actual decision runs in
 * Postgres, inside the same transaction as the content write. This mirror
 * exists so the intended behavior can be pinned by this repo's test suite
 * without a live database (no local Postgres/Supabase stack is available in
 * this environment — see the implementation report). Keep in sync by hand
 * with the SQL trigger functions if either ever changes.
 */
export function shouldFireFirstAdoptionTrigger(
  op: "INSERT" | "UPDATE",
  isGenuineNow: boolean,
  wasGenuineBefore: boolean
): boolean {
  if (op === "INSERT") return isGenuineNow;
  return isGenuineNow && !wasGenuineBefore;
}

/**
 * Records/refreshes durable venue-level Feature Adoption for a genuine
 * operator action. Called directly from saveEventAction()/
 * saveDailySpecialAction() after every genuine successful save.
 *
 * NOTE ON ROLE SINCE MIGRATION 096 REV 3: the FIRST time a venue adopts a
 * feature, durable adoption is now ALSO (redundantly, safely) recorded
 * atomically by a database trigger reacting to is_genuine_operator_engaged's
 * FALSE→TRUE transition, in the same transaction as the content write — see
 * that migration's header. This function's call here is what advances
 * last_engaged_at for every SUBSEQUENT genuine edit (the trigger only fires
 * once). If this call fails after the very first save, adoption is already
 * durable via the trigger — only last_engaged_at can go briefly stale, never
 * a lost or reverted adoption.
 *
 * Rejects impersonated and platform-admin-only contexts itself (defense in
 * depth — callers are also expected to gate before calling, but this
 * function does not trust that): if `ctx.isImpersonating` is true, or
 * `ctx.operator` is null, this is a silent no-op. `ctx.isImpersonating`/
 * `ctx.operator` must always originate from a fresh, server-side
 * resolveOperatorContext() call made in the SAME request — never from a
 * client-supplied flag.
 *
 * Always writes via a fresh service-role admin client, regardless of which
 * Supabase client the caller's own ctx.supabase happens to be (a genuine
 * single-venue "owner" login uses the plain RLS-scoped session client — see
 * impersonation.ts's buildNormalContext() Step 3 — which has no permissive
 * RLS policy on venue_feature_adoption and would otherwise fail). The
 * gating decision above is what makes this safe, not RLS.
 *
 * Idempotent and retry-safe: delegates to the record_feature_adoption() SQL
 * function (migration 096), which upserts on (venue_id, feature), preserves
 * first_adopted_at, and advances last_engaged_at unconditionally on every
 * call — so repeated genuine engagement (including repeated edits by the
 * same operator) always advances last_engaged_at, never duplicates a row.
 *
 * Never throws — a Feature Adoption bookkeeping failure must not block the
 * operator's actual Event/Daily Special save (same "notification failures
 * never block the primary action" convention used elsewhere in this
 * codebase, e.g. src/lib/email.ts's founder-notification sends).
 */
export async function recordFeatureAdoption(
  ctx: GenuineOperatorContext,
  venueId: string,
  feature: FeatureAdoptionFeature
): Promise<void> {
  if (!isGenuineOperatorContext(ctx)) return;
  // isGenuineOperatorContext() already guarantees ctx.operator != null.
  const operatorId = ctx.operator!.id;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc("record_feature_adoption", {
      p_venue_id: venueId,
      p_feature: feature,
      p_operator_id: operatorId,
    });
    if (error) {
      console.error("[recordFeatureAdoption] RPC failed:", feature, venueId, error.message);
    }
  } catch (err) {
    console.error("[recordFeatureAdoption] unexpected error:", feature, venueId, err);
  }
}

// ── Public read entry point ──────────────────────────────────────────────────

/**
 * Fetches durable adoption + live active counts for a single venue's
 * Specials (Daily Specials) and Events. Uses the Control Panel's existing
 * privileged (service-role) access pattern.
 *
 * No read-time write/reconciliation: the previous version of this function
 * opportunistically "repaired" a missing durable row when a positive active
 * count was found, by writing to venue_feature_adoption during a read. That
 * relied on the OLD engagement predicate (which could not distinguish
 * impersonation) and performed an unaudited write from a Control Panel page
 * load. Under the corrected design, is_genuine_operator_engaged and
 * venue_feature_adoption are both written synchronously, server-side, at
 * the moment of the qualifying mutation (see recordFeatureAdoption()) — a
 * positive active count with no durable row is now a genuine data-integrity
 * inconsistency, not an expected gap to silently patch over. If that
 * inconsistency is ever observed, `adopted` is still forced true in the
 * RETURNED value (the mandatory invariant: a positive active count always
 * shows a green check), but nothing is written to the database — the
 * inconsistency is logged instead, so it stays visible rather than hidden.
 */
export async function getVenueFeatureAdoption(venueId: string): Promise<VenueFeatureAdoptionResult> {
  const supabase = createAdminClient();
  // Events keep their pre-existing UTC "today" (unchanged metric).
  const todayIso = new Date().toISOString().slice(0, 10);

  const [durableResult, specialsResult, eventsResult, venueResult, sessionsResult] = await Promise.all([
    supabase
      .from("venue_feature_adoption")
      .select("feature, first_adopted_at")
      .eq("venue_id", venueId),
    // Every Daily Special row for the venue (published, draft, seeded,
    // operator-created) — classified by countDailySpecialsForAdoption().
    supabase
      .from("daily_specials")
      .select(DAILY_SPECIAL_COUNT_COLUMNS)
      .eq("venue_id", venueId),
    supabase
      .from("events")
      .select("first_date, recurrence, is_genuine_operator_engaged")
      .eq("venue_id", venueId)
      .eq("is_published", true)
      .eq("is_genuine_operator_engaged", true),
    supabase
      .from("venues")
      .select("market_geo:markets!market_id(slug)")
      .eq("id", venueId)
      .maybeSingle(),
    // Staff "Open as Operator" windows — creation-time evidence that a
    // Special was created by HHC staff, not the operator (see
    // dailySpecialAdoptionCounts.ts).
    supabase
      .from("operator_impersonation_sessions")
      .select(IMPERSONATION_WINDOW_COLUMNS)
      .eq("venue_id", venueId),
  ]);

  if (durableResult.error) {
    console.error("[getVenueFeatureAdoption] durable query failed:", venueId, durableResult.error.message);
    return { ok: false, error: "Failed to load durable Feature Adoption records." };
  }
  if (specialsResult.error) {
    console.error("[getVenueFeatureAdoption] daily_specials query failed:", venueId, specialsResult.error.message);
    return { ok: false, error: "Failed to load Daily Specials for active-count calculation." };
  }
  if (sessionsResult.error) {
    console.error("[getVenueFeatureAdoption] impersonation sessions query failed:", venueId, sessionsResult.error.message);
    return { ok: false, error: "Failed to load impersonation sessions for Daily Special origin." };
  }
  if (eventsResult.error) {
    console.error("[getVenueFeatureAdoption] events query failed:", venueId, eventsResult.error.message);
    return { ok: false, error: "Failed to load Events for active-count calculation." };
  }

  const durableFeatures = new Set(
    (durableResult.data ?? []).map((row) => row.feature as FeatureAdoptionFeature)
  );

  const specialsRows = (specialsResult.data ?? []) as unknown as DailySpecialCountRow[];
  const eventsRows = (eventsResult.data ?? []) as unknown as EventActiveRow[];

  // Daily Specials "current or upcoming" is judged against the venue's
  // market-local date (not UTC) — the same date consumers see.
  const marketSlug =
    (venueResult.data as { market_geo?: { slug?: string } | null } | null)?.market_geo?.slug ?? "";
  const venueLocalToday = getMarketLocalIsoDate(marketSlug, new Date());
  const impersonationWindows = ((sessionsResult.data ?? []) as {
    started_at: string;
    ended_at: string | null;
    expires_at: string | null;
  }[])
    .map(toImpersonationWindow)
    .filter((w): w is ImpersonationWindow => w !== null);
  const dailySpecialCounts = countDailySpecialsForAdoption(specialsRows, venueLocalToday, impersonationWindows);
  const specialsActiveCount = dailySpecialCounts.operatorCurrentOrUpcoming;
  const eventsActiveCount = countActiveEvents(eventsRows, todayIso);

  const specialsDurableAdopted = durableFeatures.has("daily_specials");
  const eventsDurableAdopted = durableFeatures.has("events");

  if (!specialsDurableAdopted && specialsActiveCount > 0) {
    console.error(
      "[getVenueFeatureAdoption] data-integrity inconsistency: positive daily_specials active count with no durable adoption row:",
      venueId
    );
  }
  if (!eventsDurableAdopted && eventsActiveCount > 0) {
    console.error(
      "[getVenueFeatureAdoption] data-integrity inconsistency: positive events active count with no durable adoption row:",
      venueId
    );
  }

  return {
    ok: true,
    data: {
      specials: {
        adopted: specialsDurableAdopted || specialsActiveCount > 0,
        activeCount: specialsActiveCount,
      },
      dailySpecialCounts,
      events: {
        adopted: eventsDurableAdopted || eventsActiveCount > 0,
        activeCount: eventsActiveCount,
      },
    },
  };
}
