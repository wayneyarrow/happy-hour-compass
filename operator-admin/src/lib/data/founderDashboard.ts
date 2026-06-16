import { createAdminClient } from "@/lib/supabase/server";
import { computeOperatorImageCount } from "@/lib/venueReadiness";
import { computeVenueSetupStatus } from "@/lib/venueSetupStatus";
import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";

// ── Plan rank for upgrade/downgrade classification ─────────────────────────────

const PLAN_RANK: Record<string, number> = {
  free: 0, pro: 1, premium: 2, enterprise: 3,
};

function isUpgrade(from: string, to: string): boolean {
  return (PLAN_RANK[to] ?? 0) > (PLAN_RANK[from] ?? 0);
}

function isDowngrade(from: string, to: string): boolean {
  return (PLAN_RANK[to] ?? 0) < (PLAN_RANK[from] ?? 0);
}

function n(count: number | null | undefined): number {
  return count ?? 0;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type TopItem = { id: string; label: string; views: number };
export type SetupItemCount = { label: string; count: number };

/** A numerator/denominator pair. The page computes % and divide-by-zero safety. */
export type ConversionRate = { numerator: number; denominator: number };

export type FounderDashboardData = {
  fetchedAt: string;

  // "Are we acquiring venue opportunities?"
  acquisition: {
    suggestedVenues:          number;
    newSuggestedVenues30d:    number;
    submittedVenues:          number;
    newSubmittedVenues30d:    number;
    seededVenues:             number;
    newSeededVenues30d:       number;
    claimedVenues:            number;
    newClaimedVenues30d:      number;
    seedToClaim:              ConversionRate;
  };

  // "Are verified venues becoming active and completing setup, and are
  //  operators actually coming back?"
  activation: {
    verifiedVenues:           number;
    activeVenues:             number;
    stillOnboarding:          number;
    onboardingComplete:       number;
    topMissingSetupItems:     SetupItemCount[];
    verifiedToActive:         ConversionRate;
    activeToVenueHq:          ConversionRate;
    // Operator usage/engagement — last_seen_at based, mutually exclusive buckets.
    activeOperators:          number;
    inactiveOperators:        number;
    neverLoggedInOperators:   number;
  };

  // "Are active venues converting to paid plans?"
  monetization: {
    totalVenues:              number;
    claimedVenues:            number;
    seededVenues:              number;
    submittedVenues:           number;
    freeVenues:                number;
    proVenues:                 number;
    premiumVenues:             number;
    paidVenues:                number;
    // Operator-level churn proxy applied to a venue-based formula — see TODO
    // at the query site. There is no venue-level churn signal yet (no venue
    // deactivation/closure event in the schema).
    churnedVenuesAllTime:      number;
    // Denominator = (Seeded + Submitted) - Churned. Suggested Venues are
    // intentionally excluded — a suggestion is a lead signal, not inventory,
    // until it becomes seeded or submitted.
    monetizationRate:          ConversionRate;
    claimToPaid:               ConversionRate;
    freeToPro:                 ConversionRate;
    proToPremium:              ConversionRate;
    upgradesLast30d:           number;
    downgradesLast30d:         number;
    churnLast30d:              number;
    // TODO: Future monetization dashboard should include MRR, total revenue,
    // revenue per active venue, and revenue per paid venue (Stripe-backed —
    // not in scope for this pass).
  };

  // "Are consumers engaging?"
  consumerDemand: {
    venueViewsLast30d: number;
    eventViewsLast30d: number;
    topVenues:         TopItem[];
    topEvents:         TopItem[];
  };

  // "What needs attention?"
  operationalSignals: {
    activeVenuesStillOnboarding: number;
    missingSetupItemInstances:    number;
    upgradeOpportunities:         number;
    // Inactive (last_seen_at < 30d ago, not null) — excludes Never Logged In,
    // which is tracked separately in Activation.
    inactiveOperators:            number;
    highDemandVenues:             number;
    highDemandEvents:             number;
  };
};

// ── High-demand thresholds (early-stage beta baselines) ───────────────────────
// TODO: revisit once venue_view_events data has been flowing for 60+ days.
const HIGH_DEMAND_VENUE = 10; // views in 30d
const HIGH_DEMAND_EVENT = 5;  // views in 30d

// ── Internal types ─────────────────────────────────────────────────────────────

type ActiveVenueRow = {
  id: string;
  created_by_operator_id: string | null;
  is_published: boolean | null;
  hh_times: string | null;
  business_hours: Record<string, unknown> | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
};

type MediaRow = { venue_id: string; url: string };
type PlanChangeRow = { from_plan: string; to_plan: string; operator_id: string };
type SubscriptionPlanRow = { operator_id: string; plan_code: string | null };
type OperatorPlanRow = { id: string; plan: string | null };

function safeDivide(numerator: number, denominator: number): ConversionRate {
  return { numerator, denominator };
}

// ── Main data fetch ────────────────────────────────────────────────────────────

export async function getFounderDashboardData(): Promise<FounderDashboardData> {
  const supabase = createAdminClient();
  const now = Date.now();
  const t30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── Batch 1: all independent queries run in parallel ──────────────────────
  const [
    r_suggestedVenues,
    r_newSuggestedVenues30d,
    r_submittedVenues,
    r_newSubmittedVenues30d,
    r_totalVenues,
    r_seededVenues,
    r_newSeededVenues30d,
    r_claimedVenues,
    r_newClaimedVenues30d,
    r_unclaimedSeededVenues,
    r_verifiedVenues,
    r_activeVenueRows,
    r_activeOperators,
    r_inactiveOperators,
    r_neverLoggedInOperators,
    r_planChanges30d,
    r_allTimeChurn,
    r_venueViews,
    r_eventViews,
  ] = await Promise.all([
    // venue_suggestions / operator_submissions — Acquisition
    supabase.from("venue_suggestions").select("*", { count: "exact", head: true }),
    supabase.from("venue_suggestions").select("*", { count: "exact", head: true }).gte("submitted_at", t30),
    supabase.from("operator_submissions").select("*", { count: "exact", head: true }),
    supabase.from("operator_submissions").select("*", { count: "exact", head: true }).gte("submitted_at", t30),

    // venues — Acquisition + Activation
    supabase.from("venues").select("*", { count: "exact", head: true }),
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("source", "seed"),
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("source", "seed").gte("created_at", t30),
    supabase.from("venues").select("*", { count: "exact", head: true }).not("claimed_at", "is", null),
    supabase.from("venues").select("*", { count: "exact", head: true }).gte("claimed_at", t30),
    // Seeded venues with no claim yet — used to derive "seeded AND claimed" for Seed → Claim.
    supabase.from("venues")
      .select("*", { count: "exact", head: true })
      .eq("source", "seed")
      .is("claimed_at", null),
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("is_verified", true),

    // Active venues (created_by_operator_id IS NOT NULL). Also the source for
    // onboarding-completion checks and the operator-plan lookup below — an
    // active venue and its attached operator are 1:1 (one-venue-per-operator).
    supabase.from("venues")
      .select("id, created_by_operator_id, is_published, hh_times, business_hours, hh_food_details, hh_drink_details")
      .not("created_by_operator_id", "is", null),

    // operators — Activation usage/engagement + Operational Signals
    // (engagement, not monetization). Three mutually exclusive buckets.
    supabase.from("operators")
      .select("*", { count: "exact", head: true })
      .gte("last_seen_at", t30),
    supabase.from("operators")
      .select("*", { count: "exact", head: true })
      .not("last_seen_at", "is", null)
      .lt("last_seen_at", t30),
    supabase.from("operators")
      .select("*", { count: "exact", head: true })
      .is("last_seen_at", null),

    // plan_change_events — Monetization
    supabase.from("plan_change_events")
      .select("from_plan, to_plan, operator_id")
      .gte("changed_at", t30),
    // Operator-level churn proxy: operators who ever downgraded from a paid
    // plan to free. TODO: replace with true venue-level churn once venue
    // deactivation/closure is tracked — there is no such signal today.
    supabase.from("plan_change_events")
      .select("operator_id")
      .in("from_plan", ["pro", "premium", "enterprise"])
      .eq("to_plan", "free"),

    // view events — fetch IDs only for JS aggregation
    // TODO: replace with a Postgres RPC (GROUP BY) once view volume justifies it
    supabase.from("venue_view_events").select("venue_id").gte("viewed_at", t30),
    supabase.from("event_view_events").select("event_id").gte("viewed_at", t30),
  ]);

  // ── Active venues + the operator ids attached to them ─────────────────────
  const activeVenues = (r_activeVenueRows.data ?? []) as ActiveVenueRow[];
  const activeOperatorIds = [
    ...new Set(
      activeVenues
        .map(v => v.created_by_operator_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ];

  // ── Process plan changes (operator-event based — unchanged) ──────────────
  const planChanges = (r_planChanges30d.data ?? []) as PlanChangeRow[];
  const upgradesLast30d   = planChanges.filter(e => isUpgrade(e.from_plan, e.to_plan)).length;
  const downgradesLast30d = planChanges.filter(e => isDowngrade(e.from_plan, e.to_plan)).length;
  const churnLast30d      = planChanges.filter(
    e => ["pro", "premium", "enterprise"].includes(e.from_plan) && e.to_plan === "free"
  ).length;

  const churnedVenuesAllTime = new Set(
    ((r_allTimeChurn.data ?? []) as { operator_id: string }[]).map(e => e.operator_id)
  ).size;

  // ── Aggregate view events for leaderboards ────────────────────────────────
  const venueViews = (r_venueViews.data ?? []) as { venue_id: string }[];
  const venueViewCounts = new Map<string, number>();
  for (const { venue_id } of venueViews) {
    venueViewCounts.set(venue_id, (venueViewCounts.get(venue_id) ?? 0) + 1);
  }

  const eventViews = (r_eventViews.data ?? []) as { event_id: string }[];
  const eventViewCounts = new Map<string, number>();
  for (const { event_id } of eventViews) {
    eventViewCounts.set(event_id, (eventViewCounts.get(event_id) ?? 0) + 1);
  }

  const topVenueEntries = [...venueViewCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topEventEntries = [...eventViewCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const activeVenueIds = activeVenues.map(v => v.id);

  // ── Batch 2: leaderboard names + venue media + operator plan lookup ───────
  const [r_venueNames, r_eventNames, r_venueMedia, r_subscriptionPlans, r_operatorPlanFallback] = await Promise.all([
    topVenueEntries.length > 0
      ? supabase.from("venues").select("id, name").in("id", topVenueEntries.map(([id]) => id))
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    topEventEntries.length > 0
      ? supabase.from("events").select("id, title").in("id", topEventEntries.map(([id]) => id))
      : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),

    // Media for active venues (to detect operator-uploaded images).
    activeVenueIds.length > 0
      ? supabase.from("media")
          .select("venue_id, url")
          .in("venue_id", activeVenueIds)
          .eq("type", "venue_image")
      : Promise.resolve({ data: [] as MediaRow[] }),

    // Plan-with-fallback lookup, batched for all operators attached to an active
    // venue. Mirrors the fallback chain in src/lib/subscriptions.ts
    // getOperatorPlanCode() (operator_subscriptions.plan_code first, then
    // operators.plan), but batched — that helper fetches one operator at a time
    // and isn't usable for a dashboard-wide join.
    // TODO: if another batch dashboard query needs this, extract a
    // getOperatorPlanCodesBatch() helper into src/lib/subscriptions.ts instead
    // of duplicating this fallback logic again.
    activeOperatorIds.length > 0
      ? supabase.from("operator_subscriptions").select("operator_id, plan_code").in("operator_id", activeOperatorIds)
      : Promise.resolve({ data: [] as SubscriptionPlanRow[] }),
    activeOperatorIds.length > 0
      ? supabase.from("operators").select("id, plan").in("id", activeOperatorIds)
      : Promise.resolve({ data: [] as OperatorPlanRow[] }),
  ]);

  // ── Build leaderboards ────────────────────────────────────────────────────
  const venueNameMap = new Map(
    (r_venueNames.data ?? []).map(v => [v.id, (v.name as string | null) ?? "Unknown"])
  );
  const eventNameMap = new Map(
    ((r_eventNames.data ?? []) as { id: string; title: string | null }[]).map(e => [
      e.id,
      e.title ?? "Unknown",
    ])
  );

  const topVenues: TopItem[] = topVenueEntries.map(([id, views]) => ({
    id,
    label: venueNameMap.get(id) ?? "Unknown",
    views,
  }));
  const topEvents: TopItem[] = topEventEntries.map(([id, views]) => ({
    id,
    label: eventNameMap.get(id) ?? "Unknown",
    views,
  }));

  const highDemandVenues = [...venueViewCounts.values()].filter(v => v > HIGH_DEMAND_VENUE).length;
  const highDemandEvents = [...eventViewCounts.values()].filter(v => v > HIGH_DEMAND_EVENT).length;

  // ── Resolve effective plan per operator (subscription first, operators.plan
  //    fallback, 'free' default) — same precedence as getOperatorPlanCode() ──
  const subscriptionPlanByOperator = new Map(
    ((r_subscriptionPlans.data ?? []) as SubscriptionPlanRow[]).map(
      r => [r.operator_id, parseOperatorPlan(r.plan_code)] as const
    )
  );
  const operatorPlanFallback = new Map(
    ((r_operatorPlanFallback.data ?? []) as OperatorPlanRow[]).map(
      r => [r.id, parseOperatorPlan(r.plan)] as const
    )
  );
  function planForOperator(operatorId: string): OperatorPlan {
    return subscriptionPlanByOperator.get(operatorId) ?? operatorPlanFallback.get(operatorId) ?? "free";
  }

  // ── Classify active venues by attached operator's plan ────────────────────
  let freeVenues = 0;
  let proVenues = 0;
  let premiumVenues = 0;
  for (const venue of activeVenues) {
    if (!venue.created_by_operator_id) continue; // query already filters this out
    const plan = planForOperator(venue.created_by_operator_id);
    if (plan === "free") freeVenues++;
    else if (plan === "pro") proVenues++;
    else if (plan === "premium") premiumVenues++;
    // 'enterprise' active venues, if any, are not bucketed in this V1 breakdown
    // (matches the pre-existing free/pro/premium-only breakdown — no enterprise
    // customers exist yet). TODO: add an enterprise bucket if one signs up.
  }
  const paidVenues = proVenues + premiumVenues;

  // Free and Pro venues may have an upgrade opportunity; Premium never does.
  const upgradeOpportunities = freeVenues + proVenues;

  // ── Compute onboarding status per active venue ─────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  // Group media URLs by venue_id for O(1) lookup below.
  const mediaByVenue = new Map<string, string[]>();
  for (const row of (r_venueMedia.data ?? []) as MediaRow[]) {
    const list = mediaByVenue.get(row.venue_id) ?? [];
    list.push(row.url);
    mediaByVenue.set(row.venue_id, list);
  }

  const missingItemCounts: Record<string, number> = {};
  let stillOnboarding = 0;

  for (const venue of activeVenues) {
    const images = (mediaByVenue.get(venue.id) ?? []).map(url => ({ url }));
    const imageCount = images.length;
    const operatorImageCount = computeOperatorImageCount(images, supabaseUrl);

    const { onboardingComplete, missingItems } = computeVenueSetupStatus(
      {
        hh_times:        venue.hh_times,
        business_hours:  venue.business_hours,
        hh_food_details: venue.hh_food_details,
        hh_drink_details: venue.hh_drink_details,
        imageCount,
        operatorImageCount,
      },
      !!venue.is_published,
    );

    if (!onboardingComplete) {
      stillOnboarding++;
      for (const label of missingItems) {
        missingItemCounts[label] = (missingItemCounts[label] ?? 0) + 1;
      }
    }
  }

  const topMissingSetupItems: SetupItemCount[] = Object.entries(missingItemCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
  const missingSetupItemInstances = topMissingSetupItems.reduce((sum, item) => sum + item.count, 0);

  const activeVenuesCount = activeVenues.length;
  const onboardingComplete = activeVenuesCount - stillOnboarding;
  const seededVenues = n(r_seededVenues.count);
  const unclaimedSeededVenues = n(r_unclaimedSeededVenues.count);
  const seededAndClaimedVenues = seededVenues - unclaimedSeededVenues;
  const claimedVenues = n(r_claimedVenues.count);
  const verifiedVenues = n(r_verifiedVenues.count);
  const totalVenues = n(r_totalVenues.count);
  const submittedVenues = n(r_submittedVenues.count);

  // Monetization denominator: Seeded + Submitted - Churned. Suggested Venues
  // are intentionally excluded — see comment on the type definition above.
  const seededSubmittedNonChurned = seededVenues + submittedVenues - churnedVenuesAllTime;

  return {
    fetchedAt: new Date().toISOString(),

    acquisition: {
      suggestedVenues:       n(r_suggestedVenues.count),
      newSuggestedVenues30d: n(r_newSuggestedVenues30d.count),
      submittedVenues,
      newSubmittedVenues30d: n(r_newSubmittedVenues30d.count),
      seededVenues,
      newSeededVenues30d:    n(r_newSeededVenues30d.count),
      claimedVenues,
      newClaimedVenues30d:   n(r_newClaimedVenues30d.count),
      seedToClaim:           safeDivide(seededAndClaimedVenues, seededVenues),
    },

    activation: {
      verifiedVenues,
      activeVenues:        activeVenuesCount,
      stillOnboarding,
      onboardingComplete,
      topMissingSetupItems,
      verifiedToActive:    safeDivide(activeVenuesCount, verifiedVenues),
      activeToVenueHq:     safeDivide(onboardingComplete, activeVenuesCount),
      activeOperators:        n(r_activeOperators.count),
      inactiveOperators:      n(r_inactiveOperators.count),
      neverLoggedInOperators: n(r_neverLoggedInOperators.count),
    },

    monetization: {
      totalVenues,
      claimedVenues,
      seededVenues,
      submittedVenues,
      freeVenues,
      proVenues,
      premiumVenues,
      paidVenues,
      churnedVenuesAllTime,
      monetizationRate:   safeDivide(paidVenues, seededSubmittedNonChurned),
      claimToPaid:        safeDivide(paidVenues, claimedVenues),
      freeToPro:           safeDivide(proVenues, freeVenues + proVenues),
      proToPremium:        safeDivide(premiumVenues, proVenues + premiumVenues),
      upgradesLast30d,
      downgradesLast30d,
      churnLast30d,
    },

    consumerDemand: {
      venueViewsLast30d: venueViews.length,
      eventViewsLast30d: eventViews.length,
      topVenues,
      topEvents,
    },

    operationalSignals: {
      activeVenuesStillOnboarding: stillOnboarding,
      missingSetupItemInstances,
      upgradeOpportunities,
      inactiveOperators: n(r_inactiveOperators.count),
      highDemandVenues,
      highDemandEvents,
    },
  };
}
