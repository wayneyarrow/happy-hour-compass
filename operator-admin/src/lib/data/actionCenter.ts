import { createAdminClient } from "@/lib/supabase/server";
import {
  computeOperatorImageCount,
  parseSpecialItemCount,
} from "@/lib/venueReadiness";
import { computeVenueSetupStatus } from "@/lib/venueSetupStatus";
import type { OnboardingCompletionMode } from "@/lib/homepagePhase";
import {
  parseOperatorPlan,
  type OperatorPlan,
  maxImages,
  maxFoodSpecials,
  maxDrinkSpecials,
  maxUsers,
  maxSearchTags,
} from "@/lib/plans";
import { getMarketById } from "@/lib/markets";
import { getVenueViewCounts, getEventViewCounts } from "@/lib/data/viewCounts";

// ── Thresholds (mirrors founderDashboard.ts) ──────────────────────────────────

const HIGH_DEMAND_VENUE = 10; // venue views in 30d
const HIGH_DEMAND_EVENT = 5;  // event views in 30d
// Exported so Venue Funnel (src/lib/data/venueFunnel.ts) can reuse the exact
// same "how stale counts as inactive" threshold for its soft activity badge,
// rather than inventing a second number.
export const INACTIVE_DAYS = 30;     // last_seen_at threshold for "inactive"

// ── Shared internal types ─────────────────────────────────────────────────────

// Exported so Venue Funnel (src/lib/data/venueFunnel.ts) can reuse the exact
// same venue row shape/select rather than re-declaring an equivalent one.
export type VenueWithSetup = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  is_published: boolean;
  is_verified: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  hh_times: string | null;
  business_hours: Record<string, unknown> | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
  created_by_operator_id: string | null;
  /** Phase 1B — Founder/Admin manual onboarding-completion override. Not null = override active. */
  onboarding_completed_override_at: string | null;
};

type OperatorRow = {
  id: string;
  email: string | null;
  last_seen_at: string | null;
};

type MediaRow   = { venue_id: string; url: string };
// Phase 2B — venue-level plan/subscription row (venue_subscriptions is the
// sole canonical source; see buildVenuePlanMap() below). Only the 3 columns
// every call site actually needs are selected — never the full
// venue_subscriptions row shape (VenueSubscriptionRow in venueSubscriptions.ts).
export type VenueSubRow = { venue_id: string; plan_code: string | null; status: string | null };
type EventRow   = { id: string; title: string | null; venue_id: string; first_date: string | null; is_published: boolean };

// Primary CRM contact row, as read from crm_venue_contacts for the Action
// Center's "Seeded Venues Needing Claims" report. Internal-only table — see
// 074_crm_venue_contacts.sql. Only the primary (is_primary = true) contact
// per venue is fetched here; a venue may have additional non-primary
// contacts not surfaced by this report.
type CrmContactRow = {
  venue_id: string;
  full_name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  outreach_status: string;
};

// ── Shared helpers ────────────────────────────────────────────────────────────

const SETUP_ITEMS_TOTAL = 6;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Exported so Venue Funnel (src/lib/data/venueFunnel.ts) can reuse the exact
// same setup-health/onboarding computation rather than re-deriving it — see
// that file for the additional onboardingCompletionMode-driven "Manual"
// badge and lane-precedence logic built on top of this.
export function computeSetupHealth(
  venue: Pick<VenueWithSetup, "id" | "is_published" | "hh_times" | "business_hours" | "hh_food_details" | "hh_drink_details" | "onboarding_completed_override_at">,
  mediaByVenue: Map<string, string[]>,
): { setupHealthScorePct: number; missingItems: string[]; onboardingComplete: boolean; onboardingCompletionMode: OnboardingCompletionMode } {
  const imageUrls = mediaByVenue.get(venue.id) ?? [];
  const images = imageUrls.map((url) => ({ url }));
  const imageCount = images.length;
  const operatorImageCount = computeOperatorImageCount(images, supabaseUrl);
  const { missingItems, onboardingComplete, onboardingCompletionMode } = computeVenueSetupStatus(
    {
      hh_times:        venue.hh_times,
      business_hours:  venue.business_hours,
      hh_food_details: venue.hh_food_details,
      hh_drink_details: venue.hh_drink_details,
      imageCount,
      operatorImageCount,
    },
    venue.is_published,
    !!venue.onboarding_completed_override_at,
  );
  // Setup health score is the raw, automatic percentage — deliberately NEVER
  // forced to 100% by a manual override (Phase 1B). onboardingComplete
  // (returned separately) is what "still onboarding" filters must use.
  const completedCount = SETUP_ITEMS_TOTAL - missingItems.length;
  const setupHealthScorePct = Math.round((completedCount / SETUP_ITEMS_TOTAL) * 100);
  return { setupHealthScorePct, missingItems, onboardingComplete, onboardingCompletionMode };
}

// ── Venue-level plan resolution (Phase 2B correction) ─────────────────────────
//
// venue_subscriptions is the sole canonical source of a venue's plan
// (src/lib/venueSubscriptions.ts) — operator_subscriptions and operators.plan
// are legacy operator-level fields and must never be consulted for a
// per-venue plan decision. That file's own header explains why: once one
// operator can own venues on different plans (Landing = Premium, Il Mercato =
// Free), there is no single operator-level value that could ever be correct
// for "this venue's plan" — falling back to one would silently leak one
// venue's paid entitlement onto a sibling Free venue, or vice versa. Every
// function below previously resolved plan via the operator-level
// buildPlanMap()/operator_subscriptions path — a stale, pre-Phase-2B-cutover
// pattern this fixes.
//
// buildVenuePlanMap() mirrors resolvePlanCodeFromVenueSubscription()'s
// contract exactly (row exists → its plan_code; no row → absent from the
// map, callers use `?? "free"`) — see that function's doc comment for the
// full rationale. It is intentionally a local, batched map rather than a
// call to the exported venueSubscriptions.ts helpers: getVenuePlanCode() is
// one DB round-trip per venue, and calling it once per venue in every report
// below would reintroduce an N+1 query; a single `.in("venue_id", [...])`
// fetch keyed into this map is the batched equivalent.
//
// Additionally treats a 'cancelled' subscription as Free regardless of its
// stored plan_code (product rule, Phase 2B Action Center correction task) —
// a cancelled subscription must never be treated as actively paid. In every
// currently-possible write path (manual cancellation via cancelVenueAction,
// and the Stripe customer.subscription.deleted webhook handler)
// plan_code is already reset to 'free' the instant status becomes
// 'cancelled', so this is a defensive safety net against a theoretical
// write-path gap, not a change to any real observed state. 'past_due' is
// deliberately NOT downgraded here — a past-due paid subscription still
// resolves to its paid plan; Past Due is a separate warning badge for a
// future UI, never a silent downgrade to Free.
export function buildVenuePlanMap(rows: VenueSubRow[]): Map<string, OperatorPlan> {
  const m = new Map<string, OperatorPlan>();
  for (const row of rows) {
    m.set(row.venue_id, row.status === "cancelled" ? "free" : parseOperatorPlan(row.plan_code));
  }
  return m;
}

// Per-venue/per-event view counts are now fetched directly as Maps via
// getVenueViewCounts()/getEventViewCounts() (src/lib/data/viewCounts.ts —
// GROUP BY RPC, migration 088) — the raw-row-fetch + JS-aggregation helpers
// that used to live here (buildVenueViewMap/buildEventViewMap) are gone;
// see that migration's header for why they were replaced.

function buildMediaMap(rows: MediaRow[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const { venue_id, url } of rows) {
    const list = m.get(venue_id) ?? [];
    list.push(url);
    m.set(venue_id, list);
  }
  return m;
}

// Keyed by venue_id → its primary CRM contact. The query this feeds already
// filters to is_primary = true, and the DB enforces at most one primary
// contact per venue (crm_venue_contacts_one_primary_per_venue_idx), so this
// is safe as a plain last-write-wins map with no dedup logic needed.
function buildPrimaryContactMap(rows: CrmContactRow[]): Map<string, CrmContactRow> {
  const m = new Map<string, CrmContactRow>();
  for (const row of rows) {
    m.set(row.venue_id, row);
  }
  return m;
}

export function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
}

function t30ago(): string {
  return new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Exported so Venue Funnel (src/lib/data/venueFunnel.ts) can fetch the same
// venue column set rather than re-declaring an equivalent select string.
export const VENUE_SELECT =
  "id, slug, name, city, is_published, is_verified, source, created_at, updated_at, claimed_at, hh_times, business_hours, hh_food_details, hh_drink_details, created_by_operator_id, onboarding_completed_override_at";

const OPERATOR_SELECT = "id, email, last_seen_at";

// ── Public row types ──────────────────────────────────────────────────────────

export type ActionCenterSummary = {
  seededNeedingClaims: number;
  activeStillOnboarding: number;
  inactiveOperators: number;
  unpublishedVenues: number;
  upgradeOpportunities: number;
  highDemandVenues: number;
  upcomingHighDemandEvents: number;
  verifiedWithoutOperators: number;
  unusedSearchTagCapacity: number;
};

export type SeededNeedingClaimsRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  createdAt: string;
  daysSinceSeeded: number;
  venueViews30d: number;
  eventViews30d: number;
  setupHealthScorePct: number;
  missingItems: string[];
  isPublished: boolean;
  // Short-term operational flag distinguishing "published in the database"
  // from "actually visible on the live public site" — see
  // computeIsLiveOnSite() below for the exact rule. Independent of
  // isPublished; a venue can be isPublished=true and isLiveOnSite=false
  // (the common case: seeded venues in a coming_soon market).
  isLiveOnSite: boolean;
  source: string | null;
  // Primary CRM contact (crm_venue_contacts, is_primary = true), if one has
  // been recorded for this venue. All null when no primary contact exists —
  // this is display-only outreach data, never part of the venue/claim model.
  primaryContactName: string | null;
  primaryContactRole: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  primaryContactOutreachStatus: string | null;
};

export type ActiveStillOnboardingRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  plan: OperatorPlan;
  setupHealthScorePct: number;
  missingItems: string[];
  isPublished: boolean;
  operatorLastSeenAt: string | null;
  daysSinceLastLogin: number | null;
  updatedAt: string;
  claimedAt: string | null;
  daysSinceActivation: number | null;
};

export type InactiveOperatorsRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  plan: OperatorPlan;
  setupHealthScorePct: number;
  operatorLastSeenAt: string | null;
  daysSinceLastLogin: number | null;
  venueViews30d: number;
  eventViews30d: number;
  isPublished: boolean;
};

export type UnpublishedVenueRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  plan: OperatorPlan | null;
  setupHealthScorePct: number;
  missingItems: string[];
  operatorLastSeenAt: string | null;
  updatedAt: string;
  venueViews30d: number;
  eventViews30d: number;
};

export type UpgradeOpportunityRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  plan: OperatorPlan;
  setupHealthScorePct: number;
  isPublished: boolean;
  limitingFactor: string;
  venueViews30d: number;
  operatorLastSeenAt: string | null;
};

export type HighDemandVenueRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  plan: OperatorPlan | null;
  setupHealthScorePct: number;
  venueViews30d: number;
  // All-time totals — additional context only. Never used to determine
  // report membership; the 30-day HIGH_DEMAND_VENUE/HIGH_DEMAND_EVENT
  // qualification logic is unchanged.
  venueViewsAllTime: number;
  eventViews30d: number;
  eventViewsAllTime: number;
  isPublished: boolean;
  operatorLastSeenAt: string | null;
};

export type HighDemandEventRow = {
  eventId: string;
  eventTitle: string;
  venueId: string;
  venueSlug: string;
  venueName: string;
  city: string | null;
  plan: OperatorPlan | null;
  venueSetupHealthScorePct: number;
  eventViews30d: number;
  // All-time total — additional context only, does not affect qualification.
  eventViewsAllTime: number;
  eventDate: string | null;
  isPublished: boolean;
};

export type VerifiedWithoutOperatorRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  source: string | null;
  venueViews30d: number;
  eventViews30d: number;
  isPublished: boolean;
};

export type UnusedSearchTagsRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  plan: OperatorPlan;
  operatorName: string;
  operatorEmail: string;
  searchTagsUsed: number;
  searchTagLimit: number;
  searchTagsRemaining: number;
};

// ── Summary (home page) ───────────────────────────────────────────────────────

export async function getActionCenterSummary(): Promise<ActionCenterSummary> {
  const supabase = createAdminClient();
  const t30 = t30ago();
  const today = new Date().toISOString().slice(0, 10);

  const [
    r_seededNoClaim,
    r_inactiveOps,
    r_unpublished,
    r_verifiedNoOp,
    venueViewMap,
    eventViewMap,
    r_activeVenues,
  ] = await Promise.all([
    supabase.from("venues").select("*", { count: "exact", head: true })
      .eq("source", "seed").is("created_by_operator_id", null),
    supabase.from("operators").select("*", { count: "exact", head: true })
      .not("last_seen_at", "is", null).lt("last_seen_at", t30),
    supabase.from("venues").select("*", { count: "exact", head: true })
      .eq("is_published", false),
    supabase.from("venues").select("*", { count: "exact", head: true })
      .eq("is_verified", true).is("created_by_operator_id", null),
    // Per-venue/per-event view counts via GROUP BY RPC (migration 088) —
    // see src/lib/data/viewCounts.ts.
    getVenueViewCounts(t30),
    getEventViewCounts(t30),
    supabase.from("venues").select(VENUE_SELECT).not("created_by_operator_id", "is", null),
  ]);

  // ── Active venues: compute onboarding + upgrade counts ───────────────────────
  const activeVenues = (r_activeVenues.data ?? []) as VenueWithSetup[];
  const activeOpIds = [...new Set(
    activeVenues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id)
  )];

  const [r_media, r_subs, r_memberships] = await Promise.all([
    activeVenues.length > 0
      ? supabase.from("media").select("venue_id, url")
          .in("venue_id", activeVenues.map((v) => v.id)).eq("type", "venue_image")
      : Promise.resolve({ data: [] as MediaRow[] }),
    activeVenues.length > 0
      ? supabase.from("venue_subscriptions").select("venue_id, plan_code, status")
          .in("venue_id", activeVenues.map((v) => v.id))
      : Promise.resolve({ data: [] as VenueSubRow[] }),
    activeOpIds.length > 0
      ? supabase.from("operator_memberships").select("operator_id").in("operator_id", activeOpIds).eq("status", "active")
      : Promise.resolve({ data: [] as { operator_id: string }[] }),
  ]);

  const mediaByVenue = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const planMap = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);

  const memberCountByOp = new Map<string, number>();
  for (const { operator_id } of (r_memberships.data ?? []) as { operator_id: string }[]) {
    memberCountByOp.set(operator_id, (memberCountByOp.get(operator_id) ?? 0) + 1);
  }

  let stillOnboarding = 0;
  let upgradeOpportunities = 0;

  for (const venue of activeVenues) {
    const { setupHealthScorePct, onboardingComplete } = computeSetupHealth(venue, mediaByVenue);
    if (!onboardingComplete) stillOnboarding++;

    const opId = venue.created_by_operator_id;
    if (opId && venue.is_published) {
      const plan = planMap.get(venue.id) ?? "free";
      if ((plan === "free" || plan === "pro") && setupHealthScorePct >= 90) {
        const imageCount = (mediaByVenue.get(venue.id) ?? []).length;
        const foodCount  = parseSpecialItemCount(venue.hh_food_details);
        const drinkCount = parseSpecialItemCount(venue.hh_drink_details);
        const teamCount  = memberCountByOp.get(opId) ?? 1;
        const atLimit =
          imageCount >= maxImages(plan) ||
          foodCount  >= maxFoodSpecials(plan) ||
          drinkCount >= maxDrinkSpecials(plan) ||
          teamCount  >= maxUsers(plan);
        if (atLimit) upgradeOpportunities++;
      }
    }
  }

  // ── View event aggregation (venueViewMap/eventViewMap fetched above) ──────────
  const highDemandVenues = [...venueViewMap.values()].filter((v) => v >= HIGH_DEMAND_VENUE).length;

  // Upcoming high demand events: event ids with >= threshold views, then filter by first_date >= today
  const topEventIds = [...eventViewMap.entries()]
    .filter(([, count]) => count >= HIGH_DEMAND_EVENT)
    .map(([id]) => id);

  let upcomingHighDemandEvents = 0;
  if (topEventIds.length > 0) {
    const { data: upcomingEvents } = await supabase
      .from("events")
      .select("id, first_date")
      .in("id", topEventIds)
      .gte("first_date", today);
    upcomingHighDemandEvents = (upcomingEvents ?? []).length;
  }

  // Reuses the full report query (rather than a parallel count computation)
  // so the summary count is guaranteed to match the report's own contents.
  const unusedSearchTagRows = await getUnusedSearchTagsOpportunities();

  return {
    seededNeedingClaims:      r_seededNoClaim.count ?? 0,
    activeStillOnboarding:    stillOnboarding,
    inactiveOperators:        r_inactiveOps.count ?? 0,
    unpublishedVenues:        r_unpublished.count ?? 0,
    upgradeOpportunities,
    highDemandVenues,
    upcomingHighDemandEvents,
    verifiedWithoutOperators: r_verifiedNoOp.count ?? 0,
    unusedSearchTagCapacity:  unusedSearchTagRows.length,
  };
}

// ── Report #1: Seeded Venues Needing Claims ───────────────────────────────────

// market_id/city_id + the joined market slug, needed only by this report to
// derive isLiveOnSite. Kept local rather than added to VENUE_SELECT/
// VenueWithSetup — every other report built on those stays untouched.
// market_geo join mirrors the existing pattern in src/lib/data/venues.ts
// (getPublishedVenuesForConsumer et al.) rather than inventing a new one.
type SeededVenueWithGeo = VenueWithSetup & {
  market_id: string | null;
  city_id: string | null;
  market_geo: { slug: string } | null;
};

/**
 * "Live on site" — a short-term operational read on whether a venue is
 * actually visible on the public website today, as opposed to merely
 * is_published=true in the database. Mirrors the same rule the public site
 * itself applies (see (website)/[market]/[city]/[slug]/page.tsx and
 * getActiveMarket()/isNearMarket() call sites): a venue only renders when
 * it's published, has a resolvable market+city, and that market's launch
 * status is "active" per src/lib/markets.ts (the hardcoded config that
 * drives all live behavior — not the DB markets table, which doesn't gate
 * anything yet). This does not redefine or replace is_published; it's a
 * second, independent read for outreach triage only.
 */
function computeIsLiveOnSite(v: SeededVenueWithGeo): boolean {
  if (!v.is_published) return false;
  if (!v.market_id || !v.city_id) return false;
  const marketSlug = v.market_geo?.slug ?? null;
  if (!marketSlug) return false;
  return getMarketById(marketSlug)?.status === "active";
}

export async function getSeededNeedingClaims(): Promise<SeededNeedingClaimsRow[]> {
  const supabase = createAdminClient();
  const t30 = t30ago();

  const { data: venuesData } = await supabase
    .from("venues")
    .select(VENUE_SELECT + ", market_id, city_id, market_geo:markets!market_id(slug)")
    .eq("source", "seed")
    .is("created_by_operator_id", null);

  const venues = (venuesData ?? []) as unknown as SeededVenueWithGeo[];
  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);

  const [r_media, venueViewMap, r_events, r_crmContacts] = await Promise.all([
    supabase.from("media").select("venue_id, url").in("venue_id", venueIds).eq("type", "venue_image"),
    getVenueViewCounts(t30, venueIds),
    supabase.from("events").select("id, venue_id").in("venue_id", venueIds),
    // Internal CRM contacts (crm_venue_contacts) — only the primary contact
    // per venue is needed for this report. Table is service-role-only
    // (see 074_crm_venue_contacts.sql); createAdminClient() above already
    // bypasses RLS, so no additional access change is needed here.
    supabase.from("crm_venue_contacts")
      .select("venue_id, full_name, role, email, phone, outreach_status")
      .in("venue_id", venueIds)
      .eq("is_primary", true),
  ]);

  const mediaByVenue   = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const eventRows      = (r_events.data ?? []) as { id: string; venue_id: string }[];
  const eventIds       = eventRows.map((e) => e.id);
  const primaryContactByVenue = buildPrimaryContactMap((r_crmContacts.data ?? []) as CrmContactRow[]);

  const eventViewMap = await getEventViewCounts(t30, eventIds);

  // event views per venue
  const eventViewsByVenue = new Map<string, number>();
  for (const { id, venue_id } of eventRows) {
    const views = eventViewMap.get(id) ?? 0;
    eventViewsByVenue.set(venue_id, (eventViewsByVenue.get(venue_id) ?? 0) + views);
  }

  const now = Date.now();

  return venues.map((v) => {
    const { setupHealthScorePct, missingItems } = computeSetupHealth(v, mediaByVenue);
    const primaryContact = primaryContactByVenue.get(v.id) ?? null;
    return {
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      createdAt: v.created_at,
      daysSinceSeeded: Math.floor((now - new Date(v.created_at).getTime()) / (1000 * 60 * 60 * 24)),
      venueViews30d: venueViewMap.get(v.id) ?? 0,
      eventViews30d: eventViewsByVenue.get(v.id) ?? 0,
      setupHealthScorePct,
      missingItems,
      isPublished: v.is_published,
      isLiveOnSite: computeIsLiveOnSite(v),
      source: v.source,
      primaryContactName: primaryContact?.full_name ?? null,
      primaryContactRole: primaryContact?.role ?? null,
      primaryContactEmail: primaryContact?.email ?? null,
      primaryContactPhone: primaryContact?.phone ?? null,
      primaryContactOutreachStatus: primaryContact?.outreach_status ?? null,
    };
  }).sort((a, b) => b.venueViews30d - a.venueViews30d);
}

// ── Report #2: Active Venues Still Onboarding ────────────────────────────────

export async function getActiveStillOnboarding(): Promise<ActiveStillOnboardingRow[]> {
  const supabase = createAdminClient();

  const { data: venuesData } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .not("created_by_operator_id", "is", null);

  const venues = (venuesData ?? []) as VenueWithSetup[];
  if (venues.length === 0) return [];

  const opIds = [...new Set(venues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id))];
  const venueIds = venues.map((v) => v.id);

  const [r_media, r_subs, r_ops] = await Promise.all([
    supabase.from("media").select("venue_id, url").in("venue_id", venueIds).eq("type", "venue_image"),
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venueIds),
    opIds.length > 0
      ? supabase.from("operators").select(OPERATOR_SELECT).in("id", opIds)
      : Promise.resolve({ data: [] as OperatorRow[] }),
  ]);

  const mediaByVenue = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const planMap      = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const opById = new Map<string, OperatorRow>();
  for (const op of (r_ops.data ?? []) as OperatorRow[]) opById.set(op.id, op);

  const rows: ActiveStillOnboardingRow[] = [];

  for (const v of venues) {
    const { setupHealthScorePct, missingItems, onboardingComplete } = computeSetupHealth(v, mediaByVenue);
    if (onboardingComplete) continue; // onboarding complete (automatic or manual override) — skip

    const opId  = v.created_by_operator_id!;
    const op    = opById.get(opId);
    const plan  = planMap.get(v.id) ?? "free";

    rows.push({
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      plan,
      setupHealthScorePct,
      missingItems,
      isPublished: v.is_published,
      operatorLastSeenAt: op?.last_seen_at ?? null,
      daysSinceLastLogin: daysSince(op?.last_seen_at ?? null),
      updatedAt: v.updated_at,
      claimedAt: v.claimed_at,
      daysSinceActivation: daysSince(v.claimed_at),
    });
  }

  return rows.sort((a, b) => a.setupHealthScorePct - b.setupHealthScorePct);
}

// ── Report #3: Inactive Operators ────────────────────────────────────────────

export async function getInactiveOperators(): Promise<InactiveOperatorsRow[]> {
  const supabase = createAdminClient();
  const t30 = t30ago();

  const { data: opsData } = await supabase
    .from("operators")
    .select(OPERATOR_SELECT)
    .not("last_seen_at", "is", null)
    .lt("last_seen_at", t30);

  const operators = (opsData ?? []) as OperatorRow[];
  if (operators.length === 0) return [];

  const opIds = operators.map((o) => o.id);

  const { data: venuesData } = await supabase
    .from("venues").select(VENUE_SELECT).in("created_by_operator_id", opIds);

  const venues = (venuesData ?? []) as VenueWithSetup[];
  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);

  // venue_subscriptions must be keyed by venue_id (Phase 2B correction), so
  // it can only be fetched once venueIds is known — moved into this second
  // batch alongside the other venue-keyed queries rather than the opIds-keyed
  // batch above.
  const [r_media, venueViewMap, r_events, r_subs] = await Promise.all([
    supabase.from("media").select("venue_id, url").in("venue_id", venueIds).eq("type", "venue_image"),
    getVenueViewCounts(t30, venueIds),
    supabase.from("events").select("id, venue_id").in("venue_id", venueIds),
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venueIds),
  ]);

  const eventRows  = (r_events.data ?? []) as { id: string; venue_id: string }[];
  const eventIds   = eventRows.map((e) => e.id);

  const eventViewMap = await getEventViewCounts(t30, eventIds);

  const eventViewsByVenue = new Map<string, number>();
  for (const { id, venue_id } of eventRows) {
    eventViewsByVenue.set(venue_id, (eventViewsByVenue.get(venue_id) ?? 0) + (eventViewMap.get(id) ?? 0));
  }

  const mediaByVenue = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const planMap      = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const opById       = new Map(operators.map((o) => [o.id, o]));

  return venues.map((v) => {
    const { setupHealthScorePct } = computeSetupHealth(v, mediaByVenue);
    const op   = opById.get(v.created_by_operator_id ?? "");
    const plan = planMap.get(v.id) ?? "free";
    return {
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      plan,
      setupHealthScorePct,
      operatorLastSeenAt: op?.last_seen_at ?? null,
      daysSinceLastLogin: daysSince(op?.last_seen_at ?? null),
      venueViews30d: venueViewMap.get(v.id) ?? 0,
      eventViews30d: eventViewsByVenue.get(v.id) ?? 0,
      isPublished: v.is_published,
    };
  }).sort((a, b) => (b.daysSinceLastLogin ?? 0) - (a.daysSinceLastLogin ?? 0));
}

// ── Report #4: Unpublished Venues ────────────────────────────────────────────

export async function getUnpublishedVenues(): Promise<UnpublishedVenueRow[]> {
  const supabase = createAdminClient();
  const t30 = t30ago();

  const { data: venuesData } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .eq("is_published", false);

  const venues = (venuesData ?? []) as VenueWithSetup[];
  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);
  const opIds = [...new Set(
    venues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id)
  )];

  const [r_media, venueViewMap, r_events, r_ops, r_subs] = await Promise.all([
    supabase.from("media").select("venue_id, url").in("venue_id", venueIds).eq("type", "venue_image"),
    getVenueViewCounts(t30, venueIds),
    supabase.from("events").select("id, venue_id").in("venue_id", venueIds),
    opIds.length > 0
      ? supabase.from("operators").select(OPERATOR_SELECT).in("id", opIds)
      : Promise.resolve({ data: [] as OperatorRow[] }),
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venueIds),
  ]);

  const eventRows = (r_events.data ?? []) as { id: string; venue_id: string }[];
  const eventIds  = eventRows.map((e) => e.id);

  const eventViewMap = await getEventViewCounts(t30, eventIds);

  const eventViewsByVenue = new Map<string, number>();
  for (const { id, venue_id } of eventRows) {
    eventViewsByVenue.set(venue_id, (eventViewsByVenue.get(venue_id) ?? 0) + (eventViewMap.get(id) ?? 0));
  }

  const mediaByVenue = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const operators    = (r_ops.data ?? []) as OperatorRow[];
  const planMap      = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const opById       = new Map(operators.map((o) => [o.id, o]));

  return venues.map((v) => {
    const { setupHealthScorePct, missingItems } = computeSetupHealth(v, mediaByVenue);
    const op   = opById.get(v.created_by_operator_id ?? "");
    const plan = v.created_by_operator_id ? (planMap.get(v.id) ?? "free") : null;
    return {
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      plan,
      setupHealthScorePct,
      missingItems,
      operatorLastSeenAt: op?.last_seen_at ?? null,
      updatedAt: v.updated_at,
      venueViews30d: venueViewMap.get(v.id) ?? 0,
      eventViews30d: eventViewsByVenue.get(v.id) ?? 0,
    };
  }).sort((a, b) => b.setupHealthScorePct - a.setupHealthScorePct);
}

// ── Report #5: Upgrade Opportunities ─────────────────────────────────────────

export async function getUpgradeOpportunities(): Promise<UpgradeOpportunityRow[]> {
  const supabase = createAdminClient();
  const t30 = t30ago();

  // Active + published venues only
  const { data: venuesData } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .not("created_by_operator_id", "is", null)
    .eq("is_published", true);

  const allVenues = (venuesData ?? []) as VenueWithSetup[];
  if (allVenues.length === 0) return [];

  const allVenueIds = allVenues.map((v) => v.id);
  const allOpIds = [...new Set(
    allVenues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id)
  )];

  const [r_media, r_subs, r_ops, venueViewMap, r_memberships] = await Promise.all([
    supabase.from("media").select("venue_id, url").in("venue_id", allVenueIds).eq("type", "venue_image"),
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", allVenueIds),
    allOpIds.length > 0
      ? supabase.from("operators").select(OPERATOR_SELECT).in("id", allOpIds)
      : Promise.resolve({ data: [] as OperatorRow[] }),
    getVenueViewCounts(t30, allVenueIds),
    allOpIds.length > 0
      ? supabase.from("operator_memberships").select("operator_id").in("operator_id", allOpIds).eq("status", "active")
      : Promise.resolve({ data: [] as { operator_id: string }[] }),
  ]);

  const mediaByVenue  = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const operators     = (r_ops.data ?? []) as OperatorRow[];
  // Phase 2B correction: plan is resolved per-venue from venue_subscriptions,
  // never per-operator — an operator who owns venues on different plans
  // (e.g. Landing = Premium, Il Mercato = Free) must have each venue
  // evaluated against ITS OWN plan's entitlement limits, not a single
  // operator-wide plan.
  const planMap       = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const opById        = new Map(operators.map((o) => [o.id, o]));

  // Team member count per operator
  const memberCountByOp = new Map<string, number>();
  for (const { operator_id } of (r_memberships.data ?? []) as { operator_id: string }[]) {
    memberCountByOp.set(operator_id, (memberCountByOp.get(operator_id) ?? 0) + 1);
  }

  const rows: UpgradeOpportunityRow[] = [];

  for (const v of allVenues) {
    const opId = v.created_by_operator_id!;
    const plan = planMap.get(v.id) ?? "free";

    if (plan !== "free" && plan !== "pro") continue;

    const { setupHealthScorePct } = computeSetupHealth(v, mediaByVenue);
    if (setupHealthScorePct < 90) continue;

    const imageCount = (mediaByVenue.get(v.id) ?? []).length;
    const foodCount  = parseSpecialItemCount(v.hh_food_details);
    const drinkCount = parseSpecialItemCount(v.hh_drink_details);
    const teamCount  = memberCountByOp.get(opId) ?? 1;

    const factors: string[] = [];
    if (imageCount >= maxImages(plan))        factors.push("Images");
    if (foodCount  >= maxFoodSpecials(plan))  factors.push("Food specials");
    if (drinkCount >= maxDrinkSpecials(plan)) factors.push("Drink specials");
    if (teamCount  >= maxUsers(plan))         factors.push("Team members");

    if (factors.length === 0) continue;

    const op = opById.get(opId);
    rows.push({
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      plan,
      setupHealthScorePct,
      isPublished: v.is_published,
      limitingFactor: factors.join(", "),
      venueViews30d: venueViewMap.get(v.id) ?? 0,
      operatorLastSeenAt: op?.last_seen_at ?? null,
    });
  }

  return rows.sort((a, b) => b.venueViews30d - a.venueViews30d);
}

// ── Report #6: High Demand Venues ────────────────────────────────────────────

export async function getHighDemandVenues(): Promise<HighDemandVenueRow[]> {
  const supabase = createAdminClient();
  const t30 = t30ago();

  // Qualification is 30-day-only, via the GROUP BY RPC (migration 088) —
  // unchanged qualification logic, just no longer a raw-row fetch subject
  // to PostgREST's default row-return cap.
  const venueViewMap = await getVenueViewCounts(t30);
  const topVenueIds = [...venueViewMap.entries()]
    .filter(([, count]) => count >= HIGH_DEMAND_VENUE)
    .map(([id]) => id);

  if (topVenueIds.length === 0) return [];

  const { data: venuesData } = await supabase
    .from("venues").select(VENUE_SELECT).in("id", topVenueIds);

  const venues = (venuesData ?? []) as VenueWithSetup[];
  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);
  const opIds = [...new Set(
    venues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id)
  )];

  const [r_media, r_subs, r_ops, r_events, venueViewsAllTimeMap] = await Promise.all([
    supabase.from("media").select("venue_id, url").in("venue_id", venueIds).eq("type", "venue_image"),
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venueIds),
    opIds.length > 0
      ? supabase.from("operators").select(OPERATOR_SELECT).in("id", opIds)
      : Promise.resolve({ data: [] as OperatorRow[] }),
    supabase.from("events").select("id, venue_id").in("venue_id", venueIds),
    // All-time total — additional context only, scoped to the venues that
    // already qualified above; never used for qualification itself.
    getVenueViewCounts(null, venueIds),
  ]);

  const eventRows = (r_events.data ?? []) as { id: string; venue_id: string }[];
  const eventIds  = eventRows.map((e) => e.id);

  const [eventViewMap, eventViewAllTimeMap] = await Promise.all([
    getEventViewCounts(t30, eventIds),
    getEventViewCounts(null, eventIds),
  ]);

  const eventViewsByVenue = new Map<string, number>();
  const eventViewsAllTimeByVenue = new Map<string, number>();
  for (const { id, venue_id } of eventRows) {
    eventViewsByVenue.set(venue_id, (eventViewsByVenue.get(venue_id) ?? 0) + (eventViewMap.get(id) ?? 0));
    eventViewsAllTimeByVenue.set(venue_id, (eventViewsAllTimeByVenue.get(venue_id) ?? 0) + (eventViewAllTimeMap.get(id) ?? 0));
  }

  const mediaByVenue = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const operators    = (r_ops.data ?? []) as OperatorRow[];
  const planMap      = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const opById       = new Map(operators.map((o) => [o.id, o]));

  return venues.map((v) => {
    const { setupHealthScorePct } = computeSetupHealth(v, mediaByVenue);
    const opId = v.created_by_operator_id;
    return {
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      plan: opId ? (planMap.get(v.id) ?? "free") : null,
      setupHealthScorePct,
      venueViews30d: venueViewMap.get(v.id) ?? 0,
      venueViewsAllTime: venueViewsAllTimeMap.get(v.id) ?? 0,
      eventViews30d: eventViewsByVenue.get(v.id) ?? 0,
      eventViewsAllTime: eventViewsAllTimeByVenue.get(v.id) ?? 0,
      isPublished: v.is_published,
      operatorLastSeenAt: opId ? (opById.get(opId)?.last_seen_at ?? null) : null,
    };
  }).sort((a, b) => b.venueViews30d - a.venueViews30d);
}

// ── Report #7: Upcoming High Demand Events ────────────────────────────────────

export async function getHighDemandEvents(): Promise<HighDemandEventRow[]> {
  const supabase = createAdminClient();
  const t30  = t30ago();
  const today = new Date().toISOString().slice(0, 10);

  // Qualification is 30-day-only, via the GROUP BY RPC (migration 088) —
  // unchanged qualification logic, just no longer a raw-row fetch subject
  // to PostgREST's default row-return cap.
  const eventViewMap = await getEventViewCounts(t30);
  const topEventIds = [...eventViewMap.entries()]
    .filter(([, count]) => count >= HIGH_DEMAND_EVENT)
    .map(([id]) => id);

  if (topEventIds.length === 0) return [];

  // Filter to upcoming events only
  const { data: eventsData } = await supabase
    .from("events")
    .select("id, title, venue_id, first_date, is_published")
    .in("id", topEventIds)
    .gte("first_date", today);

  const events = (eventsData ?? []) as EventRow[];
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const venueIds = [...new Set(events.map((e) => e.venue_id))];

  const [r_venues, r_media, r_subs, eventViewAllTimeMap] = await Promise.all([
    supabase.from("venues").select(VENUE_SELECT).in("id", venueIds),
    venueIds.length > 0
      ? supabase.from("media").select("venue_id, url").in("venue_id", venueIds).eq("type", "venue_image")
      : Promise.resolve({ data: [] as MediaRow[] }),
    venueIds.length > 0
      ? supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venueIds)
      : Promise.resolve({ data: [] as VenueSubRow[] }),
    // All-time total — additional context only, scoped to the events that
    // already qualified above; never used for qualification itself.
    getEventViewCounts(null, eventIds),
  ]);

  const venues       = (r_venues.data ?? []) as VenueWithSetup[];
  const mediaByVenue = buildMediaMap((r_media.data ?? []) as MediaRow[]);
  const planMap      = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const venueById    = new Map(venues.map((v) => [v.id, v]));

  return events.map((e) => {
    const venue = venueById.get(e.venue_id);
    if (!venue) return null;
    const { setupHealthScorePct } = computeSetupHealth(venue, mediaByVenue);
    const opId = venue.created_by_operator_id;
    return {
      eventId: e.id,
      eventTitle: e.title ?? "Untitled Event",
      venueId: venue.id,
      venueSlug: venue.slug,
      venueName: venue.name,
      city: venue.city,
      plan: opId ? (planMap.get(venue.id) ?? "free") : null,
      venueSetupHealthScorePct: setupHealthScorePct,
      eventViews30d: eventViewMap.get(e.id) ?? 0,
      eventViewsAllTime: eventViewAllTimeMap.get(e.id) ?? 0,
      eventDate: e.first_date,
      isPublished: e.is_published,
    };
  }).filter((r): r is HighDemandEventRow => r !== null)
    .sort((a, b) => b.eventViews30d - a.eventViews30d);
}

// ── Report #8: Verified Venues Without Operators ──────────────────────────────

export async function getVerifiedWithoutOperators(): Promise<VerifiedWithoutOperatorRow[]> {
  const supabase = createAdminClient();
  const t30 = t30ago();

  const { data: venuesData } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .eq("is_verified", true)
    .is("created_by_operator_id", null);

  const venues = (venuesData ?? []) as VenueWithSetup[];
  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);

  const [venueViewMap, r_events] = await Promise.all([
    getVenueViewCounts(t30, venueIds),
    supabase.from("events").select("id, venue_id").in("venue_id", venueIds),
  ]);

  const eventRows = (r_events.data ?? []) as { id: string; venue_id: string }[];
  const eventIds  = eventRows.map((e) => e.id);

  const eventViewMap = await getEventViewCounts(t30, eventIds);

  const eventViewsByVenue = new Map<string, number>();
  for (const { id, venue_id } of eventRows) {
    eventViewsByVenue.set(venue_id, (eventViewsByVenue.get(venue_id) ?? 0) + (eventViewMap.get(id) ?? 0));
  }

  return venues.map((v) => ({
    id: v.id,
    slug: v.slug,
    name: v.name,
    city: v.city,
    source: v.source,
    venueViews30d: venueViewMap.get(v.id) ?? 0,
    eventViews30d: eventViewsByVenue.get(v.id) ?? 0,
    isPublished: v.is_published,
  })).sort((a, b) => b.venueViews30d - a.venueViews30d);
}

// ── Report #9: Unused Search Tag Capacity ────────────────────────────────────
//
// Paid (Pro/Premium) operators whose venue has room left in its plan's Search
// Tag allowance — a customer-success opportunity to help them use a feature
// already included in their subscription. Reuses maxSearchTags() (the same
// plan-limit helper used by the operator-facing Search Tags form and the
// plan comparison UI) and the same used-count logic as the save-time
// enforcement in searchTagsActions.ts (venues.search_tags array length).

export async function getUnusedSearchTagsOpportunities(): Promise<UnusedSearchTagsRow[]> {
  const supabase = createAdminClient();

  const { data: venuesData } = await supabase
    .from("venues")
    .select("id, slug, name, city, created_by_operator_id, search_tags")
    .not("created_by_operator_id", "is", null);

  const venues = (venuesData ?? []) as {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    created_by_operator_id: string | null;
    search_tags: string[] | null;
  }[];
  if (venues.length === 0) return [];

  const opIds = [...new Set(
    venues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id)
  )];
  if (opIds.length === 0) return [];

  const [r_subs, r_ops] = await Promise.all([
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venues.map((v) => v.id)),
    supabase.from("operators").select("id, email, last_seen_at, name, first_name, last_name").in("id", opIds),
  ]);

  type OperatorWithNameRow = OperatorRow & {
    name: string | null;
    first_name: string | null;
    last_name: string | null;
  };

  const operators = (r_ops.data ?? []) as OperatorWithNameRow[];
  const planMap    = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const opById     = new Map(operators.map((o) => [o.id, o]));

  const rows: UnusedSearchTagsRow[] = [];

  for (const v of venues) {
    const opId = v.created_by_operator_id;
    if (!opId) continue;

    const plan = planMap.get(v.id) ?? "free";
    if (plan !== "pro" && plan !== "premium") continue; // paid plans only

    const limit = maxSearchTags(plan);
    const used  = Array.isArray(v.search_tags) ? v.search_tags.length : 0;
    const remaining = limit - used;
    if (remaining <= 0) continue; // fully utilized (or, defensively, over-limit) — not an opportunity

    const op = opById.get(opId);
    const operatorEmail = op?.email ?? "";
    const operatorName =
      op?.name ||
      [op?.first_name, op?.last_name].filter(Boolean).join(" ") ||
      operatorEmail;

    rows.push({
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      plan,
      operatorName,
      operatorEmail,
      searchTagsUsed: used,
      searchTagLimit: limit,
      searchTagsRemaining: remaining,
    });
  }

  return rows.sort((a, b) => b.searchTagsRemaining - a.searchTagsRemaining);
}
