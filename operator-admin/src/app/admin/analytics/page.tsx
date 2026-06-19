export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import {
  PLAN_LABELS,
  ANALYTICS_TIER_LABELS,
  parseOperatorPlan,
  analyticsTier,
  type OperatorPlan,
  type AnalyticsTier,
} from "@/lib/plans";
import { getMembershipRole } from "@/lib/memberships";
import {
  getOperatorAnalyticsV2,
  type MostViewedEvent,
} from "@/lib/data/operatorAnalyticsV2";

// ── Venue row ─────────────────────────────────────────────────────────────────

type AnalyticsVenueRow = {
  id: string;
  name: string | null;
  search_tags: string[];
};

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
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value?: number | string | null;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-5 bg-white rounded-xl border border-gray-200 shadow-raised">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-3xl font-bold text-gray-900 tabular-nums leading-tight mt-1">
        {value ?? "—"}
      </span>
      {note && (
        <span className="text-xs text-gray-400 mt-0.5 leading-snug">
          {note}
        </span>
      )}
    </div>
  );
}

const LOCKED_BADGE_STYLES: Record<"pro" | "premium", string> = {
  pro:     "text-amber-500",
  premium: "text-blue-500",
};

function LockedStatCard({
  label,
  requiredPlan,
}: {
  label: string;
  requiredPlan: "pro" | "premium";
}) {
  return (
    <div className="flex flex-col gap-1 p-5 bg-white rounded-xl border border-gray-200 shadow-raised opacity-60">
      <div className="flex items-center gap-1.5">
        <svg
          className="w-3 h-3 text-gray-300 shrink-0"
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
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <span className="text-3xl font-bold text-gray-200 tabular-nums leading-tight mt-1">
        —
      </span>
      <span className={`text-xs mt-0.5 font-medium ${LOCKED_BADGE_STYLES[requiredPlan]}`}>
        {PLAN_LABELS[requiredPlan]} feature
      </span>
    </div>
  );
}

function MostViewedEventCard({ event }: { event: MostViewedEvent | null }) {
  return (
    <div className="flex flex-col gap-1 p-5 bg-white rounded-xl border border-gray-200 shadow-raised">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Most Viewed Event
      </span>
      {event ? (
        <>
          <span className="text-sm font-semibold text-gray-900 leading-snug mt-1 line-clamp-2">
            {event.title}
          </span>
          <span className="text-xs text-gray-400 mt-0.5">
            {event.views.toLocaleString()} view{event.views !== 1 ? "s" : ""} &middot; Last 30 days
          </span>
        </>
      ) : (
        <>
          <span className="text-3xl font-bold text-gray-200 tabular-nums leading-tight mt-1">
            —
          </span>
          <span className="text-xs text-gray-400 mt-0.5">
            No event views yet
          </span>
        </>
      )}
    </div>
  );
}

function UpgradeNote({
  requiredPlan,
  isOwner,
  children,
}: {
  requiredPlan: "pro" | "premium";
  isOwner: boolean;
  children: React.ReactNode;
}) {
  if (!isOwner) return null;
  return (
    <p className="mt-3 text-xs text-gray-400 leading-relaxed">
      <Link
        href="/admin/subscription?open=plans"
        className={`font-semibold underline underline-offset-2 transition-colors ${
          requiredPlan === "premium"
            ? "text-blue-600 hover:text-blue-700"
            : "text-amber-600 hover:text-amber-700"
        }`}
      >
        Upgrade to {PLAN_LABELS[requiredPlan]}
      </Link>{" "}
      {children}
    </p>
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

  const plan = parseOperatorPlan(operator?.plan);
  const tier = analyticsTier(plan);

  // Plan capability flags
  const isPremium   = plan === "premium" || plan === "enterprise";
  const isProOrMore = plan === "pro" || isPremium;

  // ── Venue ─────────────────────────────────────────────────────────────────

  let venue: AnalyticsVenueRow | null = null;

  if (operator) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("id, name, search_tags")
      .eq("created_by_operator_id", operator.id)
      .maybeSingle();
    venue = data as AnalyticsVenueRow | null;
  } else if (isImpersonating && impersonatingVenueId) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("id, name, search_tags")
      .eq("id", impersonatingVenueId)
      .maybeSingle();
    venue = data as AnalyticsVenueRow | null;
  }

  // ── Analytics data ────────────────────────────────────────────────────────

  const venueTags: string[] = venue?.search_tags ?? [];

  const data = venue?.id
    ? await getOperatorAnalyticsV2(venue.id, venueTags)
    : null;

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
          See how Happy Hour Compass is helping consumers discover and engage with your venue.
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
        <div className="bg-white rounded-xl border border-gray-200 shadow-resting px-6 py-16 text-center flex flex-col items-center gap-3">
          <p className="text-base font-semibold text-gray-700">No venue yet</p>
          <p className="text-sm text-gray-400 max-w-xs">
            Set up your venue profile to start tracking performance.
          </p>
          <Link
            href="/admin/venue"
            className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors"
          >
            Create your venue &rarr;
          </Link>
        </div>
      )}

      {/* Main analytics sections — only when a venue and data exist */}
      {venue && data && (
        <div className="space-y-4">

          {/* ── Section 1: Visibility ──────────────────────────────────────── */}
          <SectionCard
            title="Visibility"
            description="How often consumers are seeing your venue, last 30 days."
          >
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Venue Views" value={data.venueViews} />
              <StatCard label="Event Views" value={data.eventViews} />

              {isPremium ? (
                <>
                  <StatCard
                    label="Discover Impressions"
                    value={data.discoverImpressions}
                  />
                  <StatCard
                    label="Discover Clicks"
                    value={data.discoverClicks}
                  />
                </>
              ) : (
                <>
                  <LockedStatCard
                    label="Discover Impressions"
                    requiredPlan="premium"
                  />
                  <LockedStatCard
                    label="Discover Clicks"
                    requiredPlan="premium"
                  />
                </>
              )}
            </div>

            {!isPremium && (
              <UpgradeNote requiredPlan="premium" isOwner={isOwner}>
                to see how often your venue appears in Discover and how many consumers click through.
              </UpgradeNote>
            )}
          </SectionCard>

          {/* ── Section 2: Engagement ──────────────────────────────────────── */}
          <SectionCard
            title="Engagement"
            description="How consumers are interacting with your venue and events, last 30 days."
          >
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Saves" value={data.saves} />
              <MostViewedEventCard event={data.mostViewedEvent} />

              {/* Top Search Tag — Pro+ only */}
              {isProOrMore ? (
                venueTags.length === 0 ? (
                  <div className="flex flex-col gap-1 p-5 bg-white rounded-xl border border-gray-200 shadow-raised">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Top Search Tag
                    </span>
                    <span className="text-sm font-semibold text-gray-500 leading-tight mt-1">
                      No tags configured
                    </span>
                    <Link
                      href="/admin/venue?section=search-tags"
                      className="text-xs text-amber-600 hover:text-amber-500 font-medium mt-0.5 transition-colors"
                    >
                      Add search tags &rarr;
                    </Link>
                  </div>
                ) : (
                  <StatCard
                    label="Top Search Tag"
                    value={data.topSearchTag ?? "—"}
                    note={
                      data.topSearchTag
                        ? "Most searched, last 30 days"
                        : "No tag activity yet"
                    }
                  />
                )
              ) : (
                <LockedStatCard label="Top Search Tag" requiredPlan="pro" />
              )}
            </div>

            {!isProOrMore && (
              <UpgradeNote requiredPlan="pro" isOwner={isOwner}>
                to add search tags and see which searches are helping consumers find you.
              </UpgradeNote>
            )}
          </SectionCard>

          {/* ── Section 3: Intent ──────────────────────────────────────────── */}
          <SectionCard
            title="Intent"
            description="Actions consumers take when they are interested, last 30 days."
          >
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Website Clicks" value={data.websiteClicks} />
              <StatCard label="Menu Clicks" value={data.menuClicks} />
              <StatCard
                label="Happy Hour Schedule Expands"
                value={data.hhScheduleExpands}
              />
              <StatCard
                label="Business Hours Expands"
                value={data.businessHoursExpands}
              />
            </div>
          </SectionCard>

        </div>
      )}
    </div>
  );
}
