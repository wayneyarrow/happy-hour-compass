/**
 * Action Center — Specials Adoption (Daily Specials, verified venues).
 *
 * Summary: number of verified venues with at least one operator-created
 * Daily Special. Report: every verified venue (including zero-Special
 * venues) with its counts, onboarding status/stage, 30-day venue views, and
 * whether it is in the initial Customer Success campaign list.
 *
 * Rules are reused, not redefined:
 *   - Daily Special classification/counts: dailySpecialAdoptionCounts.ts
 *     (shared with the venue Feature Adoption card).
 *   - "Verified": venues.is_verified = true (the platform's one
 *     verification signal — see customerSuccess/eligibility.ts).
 *   - Onboarding: computeSetupHealth() (actionCenter.ts) + operator
 *     account_activated_at; stage label: classifyVenueLane()/LANE_LABELS
 *     (venueFunnel.ts) — the same Venue Funnel stages shown elsewhere.
 *   - Views: getVenueViewCounts() over the last 30 days (Action Center's
 *     standard window).
 *
 * CAMPAIGN AGE: days since the operator's account activation —
 * daysSince(operators.account_activated_at), the exact date and calculation
 * the Venue Funnel cards show as "Since account activated". A venue whose
 * operator has no activation date stays in the full report but is never a
 * campaign candidate.
 *
 * ORIGIN: operator-created vs platform-created is decided from creation
 * evidence only (dailySpecialAdoptionCounts.ts) — which needs each venue's
 * staff impersonation windows, fetched here in one batched query.
 *
 * Not imported by actionCenter.ts (venueFunnel.ts already imports
 * actionCenter.ts — importing it back would create a cycle); the Action
 * Center page fetches getSpecialsAdoptionSummary() alongside
 * getActionCenterSummary().
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  computeSetupHealth,
  buildVenuePlanMap,
  getUpgradeOpportunities,
  daysSince,
  INACTIVE_DAYS,
  VENUE_SELECT,
  type VenueWithSetup,
  type VenueSubRow,
} from "@/lib/data/actionCenter";
import { classifyVenueLane, LANE_LABELS } from "@/lib/data/venueFunnel";
import { getVenueViewCounts } from "@/lib/data/viewCounts";
import { getMarketLocalIsoDate } from "@/lib/marketLocalDate";
import {
  countDailySpecialsForAdoption,
  DAILY_SPECIAL_COUNT_COLUMNS,
  IMPERSONATION_WINDOW_COLUMNS,
  isOperatorCreatedDailySpecial,
  toImpersonationWindow,
  type DailySpecialAdoptionCounts,
  type DailySpecialCountRow,
  type ImpersonationWindow,
} from "@/lib/customerSuccess/dailySpecialAdoptionCounts";
import {
  deriveOnboardingStatus,
  hasAdoptedDailySpecials,
  isSpecialsCampaignCandidate,
  type OnboardingStatus,
} from "@/lib/customerSuccess/specialsAdoptionPolicy";

type AdminClient = ReturnType<typeof createAdminClient>;

export type SpecialsAdoptionRow = {
  id: string;
  name: string;
  city: string | null;
  isPublished: boolean;
  /** operators.account_activated_at — null when the operator has not activated (or no operator). */
  accountActivatedAt: string | null;
  /** daysSince(accountActivatedAt) — the Venue Funnel's "Since account activated" age. */
  daysSinceActivation: number | null;
  onboardingStatus: OnboardingStatus;
  /** Venue Funnel stage label (classifyVenueLane). */
  stageLabel: string;
  venueViews30d: number;
  counts: DailySpecialAdoptionCounts;
  isCampaignCandidate: boolean;
};

/** null = the summary could not be computed (render "—", never a false 0). */
export type SpecialsAdoptionSummary = {
  /** Verified venues with >= 1 operator-created Daily Special. */
  adoptedVenues: number;
  verifiedVenues: number;
};

const PAGE = 1000;

/** Reads every row of a query in pages — PostgREST caps a single response at 1,000 rows. */
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

type SpecialRowWithVenue = DailySpecialCountRow & { venue_id: string };

async function fetchDailySpecialRows(supabase: AdminClient, venueIds: string[]): Promise<SpecialRowWithVenue[]> {
  if (venueIds.length === 0) return [];
  return fetchAllPages<SpecialRowWithVenue>((from, to) =>
    supabase
      .from("daily_specials")
      .select(DAILY_SPECIAL_COUNT_COLUMNS)
      .in("venue_id", venueIds)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

function groupByVenue<T extends { venue_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const list = m.get(row.venue_id) ?? [];
    list.push(row);
    m.set(row.venue_id, list);
  }
  return m;
}

type SessionRow = { venue_id: string; started_at: string; ended_at: string | null; expires_at: string | null };

/** Staff impersonation windows per venue — creation-time origin evidence. */
async function fetchImpersonationWindowsByVenue(
  supabase: AdminClient,
  venueIds: string[]
): Promise<Map<string, ImpersonationWindow[]>> {
  const out = new Map<string, ImpersonationWindow[]>();
  if (venueIds.length === 0) return out;
  const rows = await fetchAllPages<SessionRow>((from, to) =>
    supabase
      .from("operator_impersonation_sessions")
      .select(IMPERSONATION_WINDOW_COLUMNS)
      .in("venue_id", venueIds)
      .order("started_at", { ascending: true })
      .range(from, to)
  );
  for (const [venueId, list] of groupByVenue(rows)) {
    out.set(venueId, list.map(toImpersonationWindow).filter((w): w is ImpersonationWindow => w !== null));
  }
  return out;
}

// ── Summary (Action Center card) ────────────────────────────────────────────

export async function getSpecialsAdoptionSummary(): Promise<SpecialsAdoptionSummary | null> {
  const supabase = createAdminClient();
  try {
    const venues = await fetchAllPages<{ id: string }>((from, to) =>
      supabase.from("venues").select("id").eq("is_verified", true).order("id").range(from, to)
    );
    const venueIds = venues.map((v) => v.id);
    const [rows, windowsByVenue] = await Promise.all([
      fetchDailySpecialRows(supabase, venueIds),
      fetchImpersonationWindowsByVenue(supabase, venueIds),
    ]);
    const adopted = new Set(
      rows
        .filter((r) => isOperatorCreatedDailySpecial(r, windowsByVenue.get(r.venue_id) ?? []))
        .map((r) => r.venue_id)
    );
    return { adoptedVenues: adopted.size, verifiedVenues: venues.length };
  } catch (err) {
    console.error("[getSpecialsAdoptionSummary]", err);
    return null;
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

type VerifiedVenueRow = VenueWithSetup & { market_geo: { slug: string } | null };

type OperatorRow = { id: string; last_seen_at: string | null; account_activated_at: string | null };

export async function getSpecialsAdoptionReport(): Promise<SpecialsAdoptionRow[]> {
  const supabase = createAdminClient();
  const t30 = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const venues = await fetchAllPages<VerifiedVenueRow>((from, to) =>
    supabase
      .from("venues")
      .select(`${VENUE_SELECT}, market_geo:markets!market_id(slug)`)
      .eq("is_verified", true)
      .order("id")
      .range(from, to)
  );
  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);
  const opIds = [...new Set(venues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id))];

  const [specialRows, windowsByVenue, r_media, r_subs, r_ops, viewCounts, upgradeRows] = await Promise.all([
    fetchDailySpecialRows(supabase, venueIds),
    fetchImpersonationWindowsByVenue(supabase, venueIds),
    supabase.from("media").select("venue_id, url").in("venue_id", venueIds).eq("type", "venue_image"),
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venueIds),
    opIds.length > 0
      ? supabase.from("operators").select("id, last_seen_at, account_activated_at").in("id", opIds)
      : Promise.resolve({ data: [] as OperatorRow[] }),
    getVenueViewCounts(t30, venueIds),
    getUpgradeOpportunities(),
  ]);

  // Onboarding status and campaign eligibility depend on all three — never
  // compute the candidate list from partial data.
  for (const [label, result] of [["media", r_media], ["venue_subscriptions", r_subs], ["operators", r_ops]] as const) {
    const error = (result as { error?: { message: string } | null }).error;
    if (error) throw new Error(`[getSpecialsAdoptionReport] ${label} query failed: ${error.message}`);
  }

  const specialsByVenue = groupByVenue(specialRows);
  const mediaByVenue = new Map<string, string[]>();
  for (const { venue_id, url } of (r_media.data ?? []) as { venue_id: string; url: string }[]) {
    const list = mediaByVenue.get(venue_id) ?? [];
    list.push(url);
    mediaByVenue.set(venue_id, list);
  }
  const planMap = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const opById = new Map(((r_ops.data ?? []) as OperatorRow[]).map((op) => [op.id, op]));
  const upgradeIds = new Set(upgradeRows.map((r) => r.id));
  const now = new Date();

  return venues
    .map((v): SpecialsAdoptionRow => {
      const op = v.created_by_operator_id ? opById.get(v.created_by_operator_id) : undefined;
      const { missingItems, onboardingComplete } = computeSetupHealth(v, mediaByVenue);
      const accountActivatedAt = op?.account_activated_at ?? null;

      const onboardingStatus = deriveOnboardingStatus({
        hasOperator: !!v.created_by_operator_id,
        onboardingComplete,
        accountActivatedAt,
        missingItemsCount: missingItems.length,
      });

      const stageLabel = v.created_by_operator_id
        ? LANE_LABELS[
            classifyVenueLane({
              plan: planMap.get(v.id) ?? "free",
              isUpgradeOpportunity: upgradeIds.has(v.id),
              onboardingComplete,
              missingItemsCount: missingItems.length,
              accountActivatedAt,
              claimedAt: v.claimed_at,
              updatedAt: v.updated_at,
              operatorLastSeenAt: op?.last_seen_at ?? null,
            }).laneKey
          ]
        : "No operator";

      const todayLocal = getMarketLocalIsoDate(v.market_geo?.slug ?? "", now);
      const counts = countDailySpecialsForAdoption(
        specialsByVenue.get(v.id) ?? [],
        todayLocal,
        windowsByVenue.get(v.id) ?? []
      );
      const daysSinceActivation = daysSince(accountActivatedAt);

      return {
        id: v.id,
        name: v.name,
        city: v.city,
        isPublished: v.is_published,
        accountActivatedAt,
        daysSinceActivation,
        onboardingStatus,
        stageLabel,
        venueViews30d: viewCounts.get(v.id) ?? 0,
        counts,
        isCampaignCandidate: isSpecialsCampaignCandidate({ daysSinceActivation, onboardingStatus, counts }),
      };
    })
    .sort((a, b) => {
      // Adopters first (most operator-created Specials), then zero-Special
      // venues by 30-day views — highest-demand candidates on top.
      if (hasAdoptedDailySpecials(a.counts) !== hasAdoptedDailySpecials(b.counts)) {
        return hasAdoptedDailySpecials(a.counts) ? -1 : 1;
      }
      if (a.counts.operatorTotal !== b.counts.operatorTotal) return b.counts.operatorTotal - a.counts.operatorTotal;
      return b.venueViews30d - a.venueViews30d;
    });
}
