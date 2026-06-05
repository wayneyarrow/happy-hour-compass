export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import {
  analyticsTier,
  ANALYTICS_TIER_LABELS,
  PLAN_LABELS,
  parseOperatorPlan,
  type OperatorPlan,
  type AnalyticsTier,
} from "@/lib/plans";
import { getMembershipRole } from "@/lib/memberships";

// ── Venue row (only fields analytics needs) ───────────────────────────────────

type AnalyticsVenueRow = {
  id: string;
  name: string | null;
  is_published: boolean | null;
  address_line1: string | null;
  city: string | null;
  phone: string | null;
  website_url: string | null;
  hh_times: string | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
};

const ANALYTICS_VENUE_SELECT =
  "id, name, is_published, address_line1, city, phone, website_url, " +
  "hh_times, hh_food_details, hh_drink_details";

// ── Lightweight completeness score ────────────────────────────────────────────
// 10-signal score for the analytics card only.
// The home page's full readiness system remains the authoritative
// onboarding completeness tracker.

function computeCompleteness(
  venue: AnalyticsVenueRow,
  hasImages: boolean,
  hasEvents: boolean
): number {
  const checks = [
    !!venue.name?.trim(),
    !!venue.address_line1?.trim(),
    !!venue.city?.trim(),
    !!venue.phone?.trim(),
    !!venue.website_url?.trim(),
    !!venue.hh_times?.trim(),
    !!venue.hh_food_details?.trim(),
    !!venue.hh_drink_details?.trim(),
    hasImages,
    hasEvents,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// ── Sub-components ────────────────────────────────────────────────────────────

const PLAN_BADGE_STYLES: Record<OperatorPlan, string> = {
  free:       "bg-gray-100 text-gray-700",
  pro:        "bg-amber-100 text-amber-700",
  premium:    "bg-blue-100 text-blue-700",
  enterprise: "bg-purple-100 text-purple-700",
};

function PlanTierBadge({
  plan,
  tier,
}: {
  plan: OperatorPlan;
  tier: AnalyticsTier;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${PLAN_BADGE_STYLES[plan]}`}
    >
      {PLAN_LABELS[plan]} plan &mdash; {ANALYTICS_TIER_LABELS[tier]}
    </span>
  );
}

type StatCardProps = {
  label: string;
  value?: number | string | null;
  note?: string;
  comingSoon?: boolean;
};

function StatCard({ label, value, note, comingSoon = false }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 p-4 bg-gray-50 rounded-xl border border-gray-100">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      {comingSoon ? (
        <>
          <span className="text-2xl font-bold text-gray-200 tabular-nums leading-tight mt-1">
            —
          </span>
          <span className="text-[11px] text-gray-300 mt-0.5">Coming soon</span>
        </>
      ) : (
        <>
          <span className="text-2xl font-bold text-gray-900 tabular-nums leading-tight mt-1">
            {value ?? "—"}
          </span>
          {note && (
            <span className="text-[11px] text-gray-400 mt-0.5 leading-snug">{note}</span>
          )}
        </>
      )}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

const LOCKED_BADGE_STYLES: Record<"pro" | "premium", string> = {
  pro:     "bg-amber-100 text-amber-700",
  premium: "bg-blue-100 text-blue-700",
};

function LockedSection({
  title,
  requiredPlan,
  description,
  features,
  isOwner,
}: {
  title: string;
  requiredPlan: "pro" | "premium";
  description: string;
  features: string[];
  isOwner: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-gray-300 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <h3 className="text-sm font-semibold text-gray-400">{title}</h3>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${LOCKED_BADGE_STYLES[requiredPlan]}`}
        >
          {PLAN_LABELS[requiredPlan]}
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-3 leading-relaxed">{description}</p>
      <ul className="space-y-1">
        {features.map((f) => (
          <li key={f} className="text-xs text-gray-300">
            · {f}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <Link
          href="/admin/billing"
          className="inline-block mt-3 text-xs font-semibold text-gray-400 underline underline-offset-2 hover:text-gray-500 transition-colors"
        >
          Change your plan →
        </Link>
      ) : (
        <p className="mt-3 text-xs text-gray-400">
          Ask the account owner to change the plan.
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminAnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await resolveOperatorContext();
  const { operator, operatorError, isImpersonating, impersonatingVenueId } = ctx;

  const currentEmail = user.email ?? operator?.email ?? "";
  const currentRole = operator ? await getMembershipRole(operator.id, currentEmail) : null;
  const isOwner = isImpersonating || currentRole === "owner";

  // Plan is read from operator.plan — provisioned by migration 029.
  // parseOperatorPlan() safely defaults to 'free' for null/undefined.
  const plan = parseOperatorPlan(operator?.plan);
  const tier = analyticsTier(plan);

  // ── Venue ─────────────────────────────────────────────────────────────────

  let venue: AnalyticsVenueRow | null = null;

  if (operator) {
    const { data } = await ctx.supabase
      .from("venues")
      .select(ANALYTICS_VENUE_SELECT)
      .eq("created_by_operator_id", operator.id)
      .maybeSingle();
    venue = data as AnalyticsVenueRow | null;
  } else if (isImpersonating && impersonatingVenueId) {
    const { data } = await ctx.supabase
      .from("venues")
      .select(ANALYTICS_VENUE_SELECT)
      .eq("id", impersonatingVenueId)
      .maybeSingle();
    venue = data as AnalyticsVenueRow | null;
  }

  // ── Metric data ───────────────────────────────────────────────────────────
  // Only counts that require a venue id. Queries fail silently — null values
  // render as "—" in StatCard, which is the correct honest empty state.

  let activeEventsCount: number | null = null;
  let imagesCount: number | null = null;
  let completeness: number | null = null;

  if (venue?.id) {
    const { count: eventsRaw } = await ctx.supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venue.id)
      .eq("is_published", true);

    const { count: mediaRaw } = await ctx.supabase
      .from("media")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venue.id)
      .eq("type", "venue_image");

    activeEventsCount = eventsRaw ?? 0;
    imagesCount       = mediaRaw  ?? 0;
    completeness = computeCompleteness(
      venue,
      imagesCount > 0,
      activeEventsCount > 0
    );
  }

  // ── Section gating ────────────────────────────────────────────────────────
  // Derived entirely from analyticsTier() — no plan logic in JSX below.

  const showSearchPerf = tier !== "basic";    // Pro, Premium, Enterprise
  const showAdvanced   = tier === "advanced"; // Premium, Enterprise

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">

      {/* Page heading */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-1.5">
          <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
          <PlanTierBadge plan={plan} tier={tier} />
        </div>
        <p className="text-sm text-gray-500">
          Track how your venue is performing on Happy Hour Compass.
        </p>
      </div>

      {/* Error state */}
      {operatorError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}

      {/* No venue yet */}
      {!venue && !operatorError && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-600 mb-1">No venue yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">
            Set up your venue profile to start tracking performance.
          </p>
          <Link
            href="/admin/venue"
            className="text-sm font-medium text-amber-700 hover:text-amber-800 transition-colors"
          >
            Create your venue &rarr;
          </Link>
        </div>
      )}

      {/* Main analytics sections — only when a venue exists */}
      {venue && (
        <div className="space-y-4">

          {/* ── Venue Performance (all plans) ──────────────────────────────── */}
          <SectionCard
            title="Venue Performance"
            description="Your venue's current activity and profile status on Happy Hour Compass."
          >
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Active Events"
                value={activeEventsCount}
                note={activeEventsCount === 0 ? "No published events yet" : undefined}
              />
              <StatCard
                label="Profile Completeness"
                value={completeness !== null ? `${completeness}%` : null}
                note={
                  completeness !== null && completeness < 80
                    ? "Add more details to improve visibility"
                    : undefined
                }
              />
              <StatCard label="Venue Views" comingSoon />
              <StatCard label="Saves" comingSoon />
            </div>
          </SectionCard>

          {/* ── Search Performance (Pro+) or locked ────────────────────────── */}
          {showSearchPerf ? (
            <SectionCard
              title="Search Performance"
              description="How often your venue appears in search results and what's driving visits."
            >
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Search Appearances" comingSoon />
                <StatCard label="Search-Driven Views" comingSoon />
                <StatCard label="Top Search Tags" comingSoon />
                <StatCard label="Click-Through Rate" comingSoon />
              </div>
            </SectionCard>
          ) : (
            <LockedSection
              title="Search Performance"
              requiredPlan="pro"
              description="Understand how often your venue appears in search results and what's bringing people to your listing."
              features={[
                "Search appearances",
                "Search-driven views",
                "Top search tags",
                "Click-through rate",
              ]}
              isOwner={isOwner}
            />
          )}

          {/* ── Discover Placement (Premium+) or locked ────────────────────── */}
          {showAdvanced ? (
            <SectionCard
              title="Discover Placement"
              description="Your performance in Discover surfaces and featured placement results."
            >
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Discover Impressions" comingSoon />
                <StatCard label="Placement-Driven Views" comingSoon />
              </div>
            </SectionCard>
          ) : (
            <LockedSection
              title="Discover Placement"
              requiredPlan="premium"
              description="Track impressions and views from featured placement in Discover."
              features={[
                "Discover impressions",
                "Placement-driven views",
              ]}
              isOwner={isOwner}
            />
          )}

          {/* ── Promotional Campaigns (Premium+) or locked ─────────────────── */}
          {showAdvanced ? (
            <SectionCard
              title="Promotional Campaigns"
              description="Engagement metrics for your active happy hour campaigns."
            >
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Campaign Views" comingSoon />
                <StatCard label="Campaign Engagement" comingSoon />
              </div>
            </SectionCard>
          ) : (
            <LockedSection
              title="Promotional Campaigns"
              requiredPlan="premium"
              description="Measure views and engagement for your promotional happy hour campaigns."
              features={[
                "Campaign views",
                "Campaign engagement",
              ]}
              isOwner={isOwner}
            />
          )}

        </div>
      )}
    </div>
  );
}
