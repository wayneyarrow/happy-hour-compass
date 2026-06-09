"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { changePlanAction } from "./changePlanAction";
import { createCheckoutSessionAction } from "./stripeActions";
import {
  PLAN_LABELS,
  maxImages,
  maxFoodSpecials,
  maxDrinkSpecials,
  maxSearchTags,
  maxUsers,
  canUseRecurringEvents,
  canUseDiscoverPlacement,
  canUsePromotionalCampaigns,
  analyticsTier,
  type OperatorPlan,
  type AnalyticsTier,
} from "@/lib/plans";

// ── Visible plans (Enterprise excluded from V1 self-serve UI) ─────────────────

const VISIBLE_PLANS = ["free", "pro", "premium"] as const;
type VisiblePlan = (typeof VISIBLE_PLANS)[number];

const PLAN_RANK: Record<string, number> = {
  free: 0,
  pro: 1,
  premium: 2,
  enterprise: 3,
};

// ── Plan card metadata ────────────────────────────────────────────────────────

const PLAN_SUBTITLES: Record<VisiblePlan, string> = {
  free:    "For venues getting started",
  pro:     "Unlock better visibility and recurring promotions",
  premium: "Stand out from the competition with maximum visibility",
};

const PLAN_PRICES: Record<VisiblePlan, string> = {
  free:    "$0",
  pro:     "$9.99",
  premium: "$19.99",
};

const PLAN_KEY_BENEFITS: Record<VisiblePlan, string[]> = {
  free: [
    "Basic venue listing",
    "5 photos",
    "3 food and drink specials",
    "One-time events",
    "Basic analytics",
    "1 team member",
  ],
  pro: [
    "Recurring events",
    "5 search tags",
    "Expanded analytics",
    "2 team members",
    "10 photos",
    "6 food and drink specials",
  ],
  premium: [
    "Featured Discover placement",
    "Promotional campaigns",
    "Advanced analytics",
    "5 team members",
    "25 photos",
    "10 food and drink specials",
    "10 search tags",
  ],
};

type PlanTheme = {
  nameColor: string;
  currentRingClass: string;
  currentBgClass: string;
  currentBtnClass: string;
  selectBtnClass: string;
  checkColor: string;
  valueBadgeBg: string;
  valueBadgeText: string;
  tableHeaderClass: string;
  tableCellClass: string;
};

const PLAN_THEMES: Record<VisiblePlan, PlanTheme> = {
  free: {
    nameColor:       "text-gray-800",
    currentRingClass:"ring-2 ring-gray-400",
    currentBgClass:  "bg-gray-50",
    currentBtnClass: "bg-gray-100 text-gray-500 cursor-not-allowed",
    selectBtnClass:  "bg-gray-800 hover:bg-gray-700 text-white",
    checkColor:      "text-gray-400",
    valueBadgeBg:    "",
    valueBadgeText:  "",
    tableHeaderClass:"bg-gray-100 text-gray-700",
    tableCellClass:  "bg-gray-50 font-semibold text-gray-800",
  },
  pro: {
    nameColor:       "text-amber-600",
    currentRingClass:"ring-2 ring-amber-500",
    currentBgClass:  "bg-amber-50",
    currentBtnClass: "bg-amber-100 text-amber-600 cursor-not-allowed",
    selectBtnClass:  "bg-amber-500 hover:bg-amber-600 text-white",
    checkColor:      "text-amber-500",
    valueBadgeBg:    "",
    valueBadgeText:  "",
    tableHeaderClass:"bg-amber-100 text-amber-700",
    tableCellClass:  "bg-amber-50 font-semibold text-gray-800",
  },
  premium: {
    nameColor:       "text-blue-700",
    currentRingClass:"ring-2 ring-blue-500",
    currentBgClass:  "bg-blue-50",
    currentBtnClass: "bg-blue-100 text-blue-600 cursor-not-allowed",
    selectBtnClass:  "bg-blue-600 hover:bg-blue-700 text-white",
    checkColor:      "text-blue-500",
    valueBadgeBg:    "bg-yellow-100",
    valueBadgeText:  "text-yellow-700",
    tableHeaderClass:"bg-blue-100 text-blue-700",
    tableCellClass:  "bg-blue-50 font-semibold text-gray-800",
  },
};

// ── Comparison table helpers ──────────────────────────────────────────────────

const ANALYTICS_SHORT: Record<AnalyticsTier, string> = {
  basic:    "Basic",
  expanded: "Expanded",
  advanced: "Advanced",
};

function formatLimit(n: number): string {
  if (n === Infinity) return "Unlimited";
  if (n === 0) return "—";
  return String(n);
}

type FeatureRow = { label: string; values: Record<VisiblePlan, string> };

function buildFeatureRows(): FeatureRow[] {
  function row(label: string, fn: (p: VisiblePlan) => string): FeatureRow {
    return {
      label,
      values: Object.fromEntries(
        VISIBLE_PLANS.map((p) => [p, fn(p)])
      ) as Record<VisiblePlan, string>,
    };
  }
  return [
    row("Users",                          (p) => formatLimit(maxUsers(p))),
    row("Images",                         (p) => formatLimit(maxImages(p))),
    row("Food Specials",                  (p) => formatLimit(maxFoodSpecials(p))),
    row("Drink Specials",                 (p) => formatLimit(maxDrinkSpecials(p))),
    row("Events",                         (p) => canUseRecurringEvents(p) ? "Recurring events" : "One-time events"),
    row("Search Tags",                    (p) => formatLimit(maxSearchTags(p))),
    row("Analytics",                      (p) => ANALYTICS_SHORT[analyticsTier(p)]),
    row("Featured Placement on Discover", (p) => canUseDiscoverPlacement(p) ? "Included" : "—"),
    row("Promotional Campaigns",          (p) => canUsePromotionalCampaigns(p) ? "Included" : "—"),
  ];
}

// ── Transition content (upgrade gains / downgrade losses + keeps) ─────────────

type TransitionContent = {
  gains?: string[];
  losses?: string[];
  keeps?: string[];
};

const TRANSITION_CONTENT: Record<string, TransitionContent> = {
  "free->pro": {
    gains: [
      "Recurring events",
      "5 search tags for advanced discovery",
      "Expanded analytics",
      "2 team members (up from 1)",
      "Up to 10 photos (up from 5)",
      "6 food and drink specials (up from 3)",
    ],
  },
  "free->premium": {
    gains: [
      "Featured Discover placement",
      "Promotional campaigns",
      "Advanced analytics",
      "Recurring events",
      "10 search tags",
      "5 team members",
      "Up to 25 photos",
      "10 food and drink specials",
    ],
  },
  "pro->premium": {
    gains: [
      "Featured Discover placement",
      "Promotional campaigns",
      "Advanced analytics",
      "5 team members (up from 2)",
      "Up to 25 photos (up from 10)",
      "10 food and drink specials (up from 6)",
      "10 search tags (up from 5)",
    ],
  },
  "premium->pro": {
    losses: [
      "Featured Discover placement",
      "Promotional campaigns",
      "Advanced analytics",
    ],
    keeps: [
      "Recurring events",
      "Advanced search tags (up to 5)",
      "Expanded analytics",
      "Higher content limits than Free",
    ],
  },
  "premium->free": {
    losses: [
      "Featured Discover placement",
      "Promotional campaigns",
      "Advanced analytics",
      "Recurring events",
      "Search tags",
      "Higher content limits",
    ],
    keeps: [
      "Basic listing and happy hour display",
      "One-time events",
      "Basic analytics",
    ],
  },
  "pro->free": {
    losses: [
      "Recurring events",
      "Search tags for advanced discovery",
      "Expanded analytics",
      "Higher content limits",
    ],
    keeps: [
      "Basic listing and happy hour display",
      "One-time events",
      "Basic analytics",
    ],
  },
};

// ── Downgrade limit validation ────────────────────────────────────────────────

type LimitViolation = {
  label: string;
  used: number;
  limit: number;
};

function checkDowngradeViolations(
  targetPlan: VisiblePlan,
  usage: { images: number; food: number; drinks: number; tags: number; users: number }
): LimitViolation[] {
  const violations: LimitViolation[] = [];
  const imgLimit   = maxImages(targetPlan);
  const foodLimit  = maxFoodSpecials(targetPlan);
  const drinkLimit = maxDrinkSpecials(targetPlan);
  const tagLimit   = maxSearchTags(targetPlan);
  const userLimit  = maxUsers(targetPlan);

  if (usage.images > imgLimit)                       violations.push({ label: "Photos",         used: usage.images, limit: imgLimit });
  if (usage.food > foodLimit)                        violations.push({ label: "Food Specials",  used: usage.food,   limit: foodLimit });
  if (usage.drinks > drinkLimit)                     violations.push({ label: "Drink Specials", used: usage.drinks, limit: drinkLimit });
  if (usage.tags > tagLimit)                         violations.push({ label: "Search Tags",    used: usage.tags,   limit: tagLimit });
  if (userLimit !== Infinity && usage.users > userLimit) violations.push({ label: "Team Members",  used: usage.users,  limit: userLimit });

  return violations;
}

// ── Modal state types ─────────────────────────────────────────────────────────

type ModalStep =
  | "selector"
  | "upgrade-confirm"
  | "downgrade-blocked"
  | "downgrade-confirm";

export type ChangePlanModalProps = {
  currentPlan:      OperatorPlan;
  operatorId:       string | null;
  imageCount:       number;
  foodCount:        number;
  drinkCount:       number;
  tagCount:         number;
  userCount:        number;
  isOwner:          boolean;
  billingProvider:  string | null;
  stripeCustomerId: string | null;
};

// ── Small shared icon ─────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 shrink-0 ${className ?? ""}`}
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
  onSelect,
}: {
  plan: VisiblePlan;
  isCurrent: boolean;
  onSelect: (p: VisiblePlan) => void;
}) {
  const theme    = PLAN_THEMES[plan];
  const benefits = PLAN_KEY_BENEFITS[plan];

  return (
    <div
      className={`relative flex flex-col rounded-xl border bg-white shadow-sm overflow-hidden transition-all ${
        isCurrent
          ? `${theme.currentRingClass} ${theme.currentBgClass}`
          : "border-gray-200 hover:border-gray-300 hover:shadow-md"
      }`}
    >
      {/* Best Value badge — Premium only */}
      {plan === "premium" && (
        <div className="absolute top-3 right-3">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${theme.valueBadgeBg} ${theme.valueBadgeText}`}
          >
            ⭐ Best Value
          </span>
        </div>
      )}

      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <h3 className={`text-xl font-bold mb-0.5 ${theme.nameColor}`}>
          {PLAN_LABELS[plan]}
        </h3>
        <p className="text-xs text-gray-500 leading-snug pr-16 min-h-[2.5rem]">
          {PLAN_SUBTITLES[plan]}
        </p>
        <div className="mt-3 flex items-baseline gap-1">
          <span className={`text-3xl font-bold ${theme.nameColor}`}>
            {PLAN_PRICES[plan]}
          </span>
          <span className="text-sm text-gray-400">/month</span>
        </div>
      </div>

      {/* Benefits */}
      <div className="px-5 py-4 flex-1 border-t border-gray-100">
        <ul className="space-y-2.5">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckIcon className={`mt-0.5 ${theme.checkColor}`} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      <div className="px-5 pb-5 pt-2">
        {isCurrent ? (
          <button
            disabled
            className={`w-full py-2 rounded-lg text-sm font-semibold ${theme.currentBtnClass}`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <CheckIcon className="w-3.5 h-3.5" />
              Current Plan
            </span>
          </button>
        ) : (
          <button
            onClick={() => onSelect(plan)}
            className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${theme.selectBtnClass}`}
          >
            Select {PLAN_LABELS[plan]}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────

function ComparisonTable({
  currentPlan,
  featureRows,
}: {
  currentPlan: VisiblePlan;
  featureRows: FeatureRow[];
}) {
  return (
    <div className="mt-8 border-t border-gray-100 pt-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Plan Comparison</h3>
      <p className="text-xs text-gray-500 mb-4">
        Detailed breakdown of what&apos;s included in each plan.
      </p>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[520px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-40" />
              {VISIBLE_PLANS.map((p) => {
                const isCurrent = p === currentPlan;
                const theme     = PLAN_THEMES[p];
                return (
                  <th
                    key={p}
                    className={`px-4 py-3 text-center w-28 ${isCurrent ? theme.tableHeaderClass : ""}`}
                  >
                    <span className="flex flex-col items-center gap-0.5">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wide ${
                          isCurrent ? "" : "text-gray-400"
                        }`}
                      >
                        {PLAN_LABELS[p]}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] font-medium normal-case tracking-normal text-gray-500">
                          Current
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {featureRows.map((row, i) => (
              <tr
                key={row.label}
                className={`border-b border-gray-50 last:border-b-0 ${i % 2 === 1 ? "bg-gray-50/40" : ""}`}
              >
                <td className="px-5 py-3 text-xs font-medium text-gray-600 whitespace-nowrap">
                  {row.label}
                </td>
                {VISIBLE_PLANS.map((p) => {
                  const isCurrent = p === currentPlan;
                  return (
                    <td
                      key={p}
                      className={`px-4 py-3 text-center text-xs ${
                        isCurrent ? PLAN_THEMES[p].tableCellClass : "text-gray-400"
                      }`}
                    >
                      {row.values[p]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Hero benefits ─────────────────────────────────────────────────────────────

const HERO_BENEFITS = [
  "Get discovered by more guests",
  "Grow your Happy Hour",
  "Promote recurring events and specials",
  "Track venue performance",
];

// ── Selector view ─────────────────────────────────────────────────────────────

function SelectorView({
  currentPlan,
  featureRows,
  onSelect,
}: {
  currentPlan: VisiblePlan;
  featureRows: FeatureRow[];
  onSelect: (p: VisiblePlan) => void;
}) {
  return (
    <div>
      {/* Hero */}
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-5">
          Choose the plan that&apos;s right for your venue
        </h2>
        <div className="inline-grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-2 text-left">
          {HERO_BENEFITS.map((b) => (
            <div key={b} className="flex items-center gap-2 text-sm text-gray-700">
              <CheckIcon className="text-emerald-500 shrink-0" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {VISIBLE_PLANS.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            isCurrent={plan === currentPlan}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Comparison table */}
      <ComparisonTable currentPlan={currentPlan} featureRows={featureRows} />
    </div>
  );
}

// ── Confirm view (upgrade or eligible downgrade) ──────────────────────────────

function ConfirmView({
  isUpgrade,
  isStripeCheckout,
  toPlan,
  content,
  isPending,
  actionError,
  onConfirm,
  onBack,
}: {
  isUpgrade: boolean;
  isStripeCheckout: boolean;
  toPlan: VisiblePlan;
  content: TransitionContent;
  isPending: boolean;
  actionError: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const theme = PLAN_THEMES[toPlan];

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-1">
        Confirm {isUpgrade ? "upgrade" : "downgrade"} to {PLAN_LABELS[toPlan]}
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        {isStripeCheckout
          ? "You'll be taken to Stripe to complete payment securely."
          : "Your plan will change immediately."}
      </p>

      {/* Upgrade: what you'll unlock */}
      {isUpgrade && content.gains && content.gains.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 mb-6">
          <p className="text-sm font-semibold text-emerald-800 mb-3">You&apos;ll unlock:</p>
          <ul className="space-y-2">
            {content.gains.map((g) => (
              <li key={g} className="flex items-start gap-2 text-sm text-emerald-700">
                <CheckIcon className="mt-0.5 text-emerald-500" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Downgrade: what you'll lose and keep */}
      {!isUpgrade && (
        <div className="space-y-4 mb-6">
          {content.losses && content.losses.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5">
              <p className="text-sm font-semibold text-red-800 mb-3">You will lose:</p>
              <ul className="space-y-2">
                {content.losses.map((l) => (
                  <li key={l} className="flex items-start gap-2 text-sm text-red-700">
                    <span
                      className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {content.keeps && content.keeps.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
              <p className="text-sm font-semibold text-gray-700 mb-3">You will keep:</p>
              <ul className="space-y-2">
                {content.keeps.map((k) => (
                  <li key={k} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckIcon className="mt-0.5 text-gray-400" />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
            isUpgrade
              ? theme.selectBtnClass
              : "bg-gray-800 hover:bg-gray-700 text-white"
          }`}
        >
          {isPending
            ? isStripeCheckout ? "Redirecting…" : "Updating…"
            : isUpgrade
            ? isStripeCheckout ? "Continue" : "Confirm Upgrade"
            : "Confirm Downgrade"}
        </button>
      </div>
    </div>
  );
}

// ── Blocked downgrade view ────────────────────────────────────────────────────

function BlockedView({
  toPlan,
  violations,
  onBack,
}: {
  toPlan: VisiblePlan;
  violations: LimitViolation[];
  onBack: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-1">
        Before you can downgrade to {PLAN_LABELS[toPlan]}
      </h2>
      <p className="text-sm text-gray-600 mb-6">
        Your venue currently exceeds the limits included in {PLAN_LABELS[toPlan]}.
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-amber-800 mb-3">
          Reduce the following before changing plans:
        </p>
        <ul className="space-y-3">
          {violations.map((v) => (
            <li key={v.label} className="flex items-center justify-between text-sm">
              <span className="font-medium text-amber-900">{v.label}</span>
              <span className="text-amber-700">
                {v.used} used&nbsp;/&nbsp;
                {v.limit === 0 ? "not included" : `${v.limit} allowed`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        Nothing will be deleted automatically. Once your venue is within the{" "}
        {PLAN_LABELS[toPlan]} limits, you&apos;ll be able to downgrade.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
        >
          Back to Plans
        </button>
        <button
          type="button"
          disabled
          className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-400 cursor-not-allowed"
        >
          Confirm Downgrade
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChangePlanModal({
  currentPlan,
  operatorId,
  imageCount,
  foodCount,
  drinkCount,
  tagCount,
  userCount,
  isOwner,
  // billingProvider and stripeCustomerId are passed from page.tsx but
  // not needed inside the modal — plan changes route through Stripe Checkout
  // for upgrades based solely on the target plan, not the current provider.
}: ChangePlanModalProps) {
  const router            = useRouter();
  const [isOpen,          setIsOpen]       = useState(false);
  const [step,            setStep]         = useState<ModalStep>("selector");
  const [selectedPlan,    setSelectedPlan] = useState<VisiblePlan | null>(null);
  const [violations,      setViolations]   = useState<LimitViolation[]>([]);
  const [actionError,     setActionError]  = useState<string | null>(null);
  const [successMsg,      setSuccessMsg]   = useState<string | null>(null);
  const [isPending,       startTransition] = useTransition();
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const featureRows = buildFeatureRows();

  // Enterprise operators see themselves at the top visible tier.
  const visibleCurrentPlan: VisiblePlan =
    currentPlan === "enterprise"
      ? "premium"
      : (VISIBLE_PLANS as readonly string[]).includes(currentPlan)
      ? (currentPlan as VisiblePlan)
      : "free";

  function openModal() {
    setStep("selector");
    setSelectedPlan(null);
    setActionError(null);
    setViolations([]);
    setIsOpen(true);
  }

  function closeModal() {
    if (isPending) return;
    setIsOpen(false);
  }

  function handlePlanSelect(plan: VisiblePlan) {
    setSelectedPlan(plan);
    setActionError(null);

    const isUpgrading = PLAN_RANK[plan] > PLAN_RANK[visibleCurrentPlan];

    if (isUpgrading) {
      setStep("upgrade-confirm");
    } else {
      const v = checkDowngradeViolations(plan, {
        images: imageCount,
        food:   foodCount,
        drinks: drinkCount,
        tags:   tagCount,
        users:  userCount,
      });
      setViolations(v);
      setStep(v.length > 0 ? "downgrade-blocked" : "downgrade-confirm");
    }
  }

  function handleConfirm() {
    if (!selectedPlan || !operatorId) return;
    setActionError(null);

    const isStripeUpgrade =
      PLAN_RANK[selectedPlan] > PLAN_RANK[visibleCurrentPlan] &&
      (selectedPlan === "pro" || selectedPlan === "premium");

    startTransition(async () => {
      if (isStripeUpgrade) {
        // Route paid upgrades through Stripe Checkout.
        // plan_code is activated by the webhook — NOT this redirect.
        const result = await createCheckoutSessionAction(selectedPlan as "pro" | "premium");
        if (result.ok && result.url) {
          window.location.href = result.url;
        } else {
          setActionError(result.error ?? "Billing is temporarily unavailable. Please try again later.");
        }
      } else {
        const result = await changePlanAction(operatorId, selectedPlan);
        if (result.ok) {
          const msg = `You're now on the ${PLAN_LABELS[selectedPlan]} plan.`;
          // Close before setting success so toast doesn't appear inside modal.
          setIsOpen(false);
          setSuccessMsg(msg);
          if (successTimerRef.current) clearTimeout(successTimerRef.current);
          successTimerRef.current = setTimeout(() => setSuccessMsg(null), 5000);
          router.refresh();
        } else {
          setActionError(result.error ?? "Something went wrong. Please try again.");
        }
      }
    });
  }

  // Escape key → close (unless action is in-flight)
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) setIsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isPending]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const isUpgrade = selectedPlan
    ? PLAN_RANK[selectedPlan] > PLAN_RANK[visibleCurrentPlan]
    : false;

  const transitionKey     = selectedPlan ? `${visibleCurrentPlan}->${selectedPlan}` : null;
  const transitionContent = transitionKey ? (TRANSITION_CONTENT[transitionKey] ?? {}) : null;

  const modalTitle =
    step === "selector"
      ? "Change Plan"
      : step === "upgrade-confirm" && selectedPlan
      ? `Upgrade to ${PLAN_LABELS[selectedPlan]}`
      : selectedPlan
      ? `Downgrade to ${PLAN_LABELS[selectedPlan]}`
      : "Change Plan";

  return (
    <>
      {/* Success toast — fixed top-right */}
      {successMsg && (
        <div
          className="fixed top-4 right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl shadow-lg text-sm text-emerald-700 font-medium"
          role="status"
        >
          <CheckIcon className="text-emerald-500" />
          {successMsg}
        </div>
      )}

      {/* Trigger button — owner only */}
      <button
        type="button"
        onClick={openModal}
        disabled={!operatorId || !isOwner}
        title={!isOwner ? "Only the account owner can change the plan." : undefined}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 hover:bg-gray-800 text-white transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        Change Plan
      </button>

      {/* Modal */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            aria-hidden="true"
            onClick={closeModal}
          />

          {/* Scroll container */}
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label={modalTitle}
          >
            <div className="flex min-h-full items-start justify-center p-4 pt-8 pb-8">
              <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl">
                {/* Modal header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-500">{modalTitle}</span>
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isPending}
                    aria-label="Close"
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Modal body */}
                <div className="p-6 sm:p-8">
                  {step === "selector" && (
                    <SelectorView
                      currentPlan={visibleCurrentPlan}
                      featureRows={featureRows}
                      onSelect={handlePlanSelect}
                    />
                  )}

                  {(step === "upgrade-confirm" || step === "downgrade-confirm") &&
                    selectedPlan &&
                    transitionContent && (
                      <ConfirmView
                        isUpgrade={isUpgrade}
                        isStripeCheckout={isUpgrade && (selectedPlan === "pro" || selectedPlan === "premium")}
                        toPlan={selectedPlan}
                        content={transitionContent}
                        isPending={isPending}
                        actionError={actionError}
                        onConfirm={handleConfirm}
                        onBack={() => setStep("selector")}
                      />
                    )}

                  {step === "downgrade-blocked" && selectedPlan && (
                    <BlockedView
                      toPlan={selectedPlan}
                      violations={violations}
                      onBack={() => setStep("selector")}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
