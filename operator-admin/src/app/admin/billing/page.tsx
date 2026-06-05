export const dynamic = "force-dynamic";
export const metadata = { title: "Plan" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import {
  PLAN_LABELS,
  parseOperatorPlan,
  maxImages,
  maxFoodSpecials,
  maxDrinkSpecials,
  maxSearchTags,
  maxUsers,
  canUseRecurringEvents,
  canUseAdvancedSearchTags,
  type OperatorPlan,
} from "@/lib/plans";
import { getOperatorSubscription, type SubscriptionStatus } from "@/lib/subscriptions";
import { parseSpecialItemCount } from "@/lib/venueReadiness";
import { countOperatorMembers, getMembershipRole } from "@/lib/memberships";
import ChangePlanModal from "./ChangePlanModal";

// ── Plan metadata ─────────────────────────────────────────────────────────────

const PLAN_DESCRIPTIONS: Record<OperatorPlan, string> = {
  free:       "Basic tools to manage your venue listing and appear on Happy Hour Compass.",
  pro:        "Expanded tools for venues that want more visibility, more content, and stronger discovery features.",
  premium:    "Advanced placement and promotional tools for venues that want maximum visibility.",
  enterprise: "Unlimited capacity and advanced features for high-volume operators.",
};

const PLAN_HEADING_COLOR: Record<OperatorPlan, string> = {
  free:       "text-gray-700",
  pro:        "text-amber-600",
  premium:    "text-blue-600",
  enterprise: "text-purple-600",
};

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  SubscriptionStatus,
  { dot: string; label: string; text: string }
> = {
  active:    { dot: "bg-green-400",  label: "text-green-700", text: "Active" },
  pending:   { dot: "bg-amber-400",  label: "text-amber-700", text: "Pending" },
  past_due:  { dot: "bg-red-400",    label: "text-red-700",   text: "Past Due" },
  cancelled: { dot: "bg-gray-300",   label: "text-gray-500",  text: "Cancelled" },
};

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${s.label}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} aria-hidden="true" />
      {s.text}
    </span>
  );
}

// ── Utilization row ───────────────────────────────────────────────────────────

type NumericUtilRow = {
  kind: "numeric";
  label: string;
  used: number;
  limit: number;
  hasVenue: boolean;
};
type LockedUtilRow = {
  kind: "locked";
  label: string;
  requiredPlan: "pro" | "premium";
};
type InfoUtilRow = {
  kind: "info";
  label: string;
  note: string;
};
type UtilRowProps = NumericUtilRow | LockedUtilRow | InfoUtilRow;

const LOCK_PLAN_BADGE: Record<"pro" | "premium", string> = {
  pro:     "bg-amber-100 text-amber-700",
  premium: "bg-blue-100 text-blue-700",
};

function UtilRow(props: UtilRowProps) {
  if (props.kind === "locked") {
    return (
      <div className="flex items-center justify-between py-3.5 border-b border-gray-50 last:border-b-0">
        <div className="flex items-center gap-2">
          <svg
            className="w-3.5 h-3.5 text-gray-300 shrink-0"
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
          <span className="text-sm text-gray-400">{props.label}</span>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${LOCK_PLAN_BADGE[props.requiredPlan]}`}
        >
          {PLAN_LABELS[props.requiredPlan]} and up
        </span>
      </div>
    );
  }

  if (props.kind === "info") {
    return (
      <div className="flex items-center justify-between py-3.5 border-b border-gray-50 last:border-b-0">
        <span className="text-sm text-gray-700">{props.label}</span>
        <span className="text-sm text-gray-500">{props.note}</span>
      </div>
    );
  }

  // numeric
  const { label, used, limit, hasVenue } = props;

  if (!hasVenue) {
    return (
      <div className="flex items-center justify-between py-3.5 border-b border-gray-50 last:border-b-0">
        <span className="text-sm text-gray-700">{label}</span>
        <span className="text-sm text-gray-300">—</span>
      </div>
    );
  }

  const isUnlimited = limit === Infinity;
  const pct = isUnlimited ? 0 : Math.round((used / limit) * 100);
  const atLimit   = !isUnlimited && used >= limit;
  const nearLimit = !isUnlimited && !atLimit && pct >= 80;

  return (
    <div className="py-3.5 border-b border-gray-50 last:border-b-0">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm ${atLimit ? "font-medium text-gray-800" : "text-gray-700"}`}>
          {label}
        </span>
        <span
          className={`text-sm font-medium tabular-nums ${
            atLimit ? "text-red-600" : nearLimit ? "text-amber-600" : "text-gray-700"
          }`}
        >
          {isUnlimited ? `${used}` : `${used} / ${limit}`}
          {isUnlimited && (
            <span className="text-xs font-normal text-gray-400 ml-1.5">Unlimited</span>
          )}
        </span>
      </div>
      {!isUnlimited && (
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${
              atLimit ? "bg-red-400" : nearLimit ? "bg-amber-400" : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      )}
      {atLimit && (
        <p className="text-xs text-red-500 mt-1.5">
          You&rsquo;ve reached your plan limit for {label.toLowerCase()}.
        </p>
      )}
    </div>
  );
}

// ── Venue row (only fields this page needs) ───────────────────────────────────

type BillingVenueRow = {
  id: string;
  hh_food_details: string | null;
  hh_drink_details: string | null;
  search_tags: string[] | null;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await resolveOperatorContext();
  const { operator, operatorError, isImpersonating, impersonatingVenueId } = ctx;

  // ── Subscription (plan + status) ──────────────────────────────────────────
  const subscription = operator ? await getOperatorSubscription(operator.id) : null;
  const plan: OperatorPlan =
    subscription?.plan_code ?? parseOperatorPlan(operator?.plan);
  const status: SubscriptionStatus = subscription?.status ?? "active";

  // ── Venue usage data ──────────────────────────────────────────────────────

  let venue: BillingVenueRow | null = null;

  if (operator) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("id, hh_food_details, hh_drink_details, search_tags")
      .eq("created_by_operator_id", operator.id)
      .maybeSingle();
    venue = data as BillingVenueRow | null;
  } else if (isImpersonating && impersonatingVenueId) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("id, hh_food_details, hh_drink_details, search_tags")
      .eq("id", impersonatingVenueId)
      .maybeSingle();
    venue = data as BillingVenueRow | null;
  }

  let imageCount = 0;
  let eventCount = 0;

  if (venue?.id) {
    const [{ count: imgRaw }, { count: evtRaw }] = await Promise.all([
      ctx.supabase
        .from("media")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venue.id)
        .eq("type", "venue_image"),
      ctx.supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venue.id)
        .eq("is_published", true),
    ]);
    imageCount = imgRaw ?? 0;
    eventCount = evtRaw ?? 0;
  }

  // ── Derived usage ─────────────────────────────────────────────────────────

  const hasVenue     = !!venue;
  const foodCount    = parseSpecialItemCount(venue?.hh_food_details);
  const drinkCount   = parseSpecialItemCount(venue?.hh_drink_details);
  const tagCount     = (venue?.search_tags ?? []).length;

  const imgLimit     = maxImages(plan);
  const foodLimit    = maxFoodSpecials(plan);
  const drinkLimit   = maxDrinkSpecials(plan);
  const tagLimit     = maxSearchTags(plan);
  const userLimit    = maxUsers(plan);
  const hasRecurring = canUseRecurringEvents(plan);
  const hasTagAccess = canUseAdvancedSearchTags(plan);

  // User count (active + pending invites)
  const userCount = operator ? await countOperatorMembers(operator.id) : 0;

  // Current user's membership role — used to gate the Change Plan button.
  // Impersonation sessions are treated as owners for plan management.
  const currentEmail = user.email ?? "";
  const currentRole  = operator && currentEmail
    ? await getMembershipRole(operator.id, currentEmail)
    : null;
  const isOwner = isImpersonating || currentRole === "owner";

  // ── Recommendations ───────────────────────────────────────────────────────

  const recs: string[] = [];

  if (hasVenue) {
    if (imgLimit !== Infinity && imageCount < imgLimit) {
      recs.push(
        "Upload more photos to better showcase your venue — listings with more images get more attention from guests."
      );
    }
    if (foodCount === 0) {
      recs.push(
        "Add food specials to make your listing more complete. Food deals are one of the top things guests look for."
      );
    } else if (foodLimit !== Infinity && foodCount < foodLimit) {
      const rem = foodLimit - foodCount;
      recs.push(
        `Your plan supports ${rem} more food special${rem === 1 ? "" : "s"} — use them to make your happy hour offering more complete.`
      );
    }
    if (drinkCount === 0) {
      recs.push(
        "Add drink specials — they're the #1 reason guests choose a happy hour venue."
      );
    } else if (drinkLimit !== Infinity && drinkCount < drinkLimit) {
      const rem = drinkLimit - drinkCount;
      recs.push(
        `Your plan supports ${rem} more drink special${rem === 1 ? "" : "s"} — more drink deals means more guest interest.`
      );
    }
    if (hasTagAccess && tagCount === 0) {
      recs.push(
        "Add search tags to help guests discover your venue in Advanced Search."
      );
    }
    if (eventCount === 0) {
      recs.push("Create your first event to give guests another reason to visit.");
    }
  }

  // ── Event row note ────────────────────────────────────────────────────────
  const eventNote = hasVenue
    ? hasRecurring
      ? `${eventCount} active — recurring supported`
      : `${eventCount} active — one-time only`
    : "—";

  return (
    <div className="max-w-3xl">

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Subscription</h2>
        <p className="text-sm text-gray-500">
          Your current subscription plan and how you&rsquo;re using it.
        </p>
      </div>

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {operatorError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}

      {/* ── 1. Current Plan Card ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
          Current Plan
        </p>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <h3 className={`text-2xl font-bold mb-1.5 ${PLAN_HEADING_COLOR[plan]}`}>
              {PLAN_LABELS[plan]} Plan
            </h3>
            <div className="mb-3">
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              {PLAN_DESCRIPTIONS[plan]}
            </p>
          </div>
          <div className="shrink-0">
            <ChangePlanModal
              currentPlan={plan}
              operatorId={operator?.id ?? null}
              imageCount={imageCount}
              foodCount={foodCount}
              drinkCount={drinkCount}
              tagCount={tagCount}
              userCount={userCount}
              isOwner={isOwner}
            />
          </div>
        </div>
      </div>

      {/* ── 2. Plan Utilization ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Plan Usage</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {hasVenue
              ? "How much of your plan you're currently using."
              : "Set up your venue to see usage."}
          </p>
        </div>
        <div className="px-6 py-1">
          <UtilRow
            kind="numeric"
            label="Images"
            used={imageCount}
            limit={imgLimit}
            hasVenue={hasVenue}
          />
          <UtilRow
            kind="numeric"
            label="Food Specials"
            used={foodCount}
            limit={foodLimit}
            hasVenue={hasVenue}
          />
          <UtilRow
            kind="numeric"
            label="Drink Specials"
            used={drinkCount}
            limit={drinkLimit}
            hasVenue={hasVenue}
          />
          {hasTagAccess ? (
            <UtilRow
              kind="numeric"
              label="Search Tags"
              used={tagCount}
              limit={tagLimit}
              hasVenue={hasVenue}
            />
          ) : (
            <UtilRow kind="locked" label="Search Tags" requiredPlan="pro" />
          )}
          <UtilRow
            kind="numeric"
            label="Users"
            used={userCount}
            limit={userLimit}
            hasVenue={true}
          />
          <UtilRow kind="info" label="Active Events" note={eventNote} />
        </div>
      </div>

      {/* ── 3. Getting More From Your Plan ────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">
          Getting More From Your Plan
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Practical ways to get more value from the plan you&rsquo;re already on.
        </p>
        {recs.length === 0 ? (
          <p className="text-sm text-gray-500">
            {hasVenue
              ? "You're making excellent use of your current plan."
              : "Set up your venue to see personalised recommendations."}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {recs.map((rec, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700">
                <span
                  className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                  aria-hidden="true"
                />
                {rec}
              </li>
            ))}
          </ul>
        )}
      </div>


    </div>
  );
}
