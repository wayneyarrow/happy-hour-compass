export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import {
  PLAN_LABELS,
  parseOperatorPlan,
  analyticsTier,
  maxImages,
  maxFoodSpecials,
  maxDrinkSpecials,
  maxUsers,
  maxSearchTags,
  canUseRecurringEvents,
  canUsePromotionalCampaigns,
  type OperatorPlan,
  type AnalyticsTier,
} from "@/lib/plans";

// Plans shown in the comparison table.
// Enterprise is intentionally excluded from the V1 UI.
// Enterprise remains fully supported in the plans.ts architecture.
const VISIBLE_PLANS = ["free", "pro", "premium"] as const;
type VisiblePlan = (typeof VISIBLE_PLANS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLimit(n: number): string {
  if (n === Infinity) return "Unlimited";
  if (n === 0) return "—";
  return String(n);
}

// ── Plan metadata ─────────────────────────────────────────────────────────────

const PLAN_DESCRIPTIONS: Record<OperatorPlan, string> = {
  free:       "Core tools to set up your venue and happy hour listing.",
  pro:        "More content capacity, expanded analytics, and recurring events.",
  premium:    "Full discovery features, advanced analytics, and promotional tools.",
  enterprise: "Unlimited capacity and advanced features for high-volume operators.",
};

const PLAN_BADGE_STYLES: Record<OperatorPlan, string> = {
  free:       "bg-gray-100 text-gray-700",
  pro:        "bg-amber-100 text-amber-700",
  premium:    "bg-blue-100 text-blue-700",
  enterprise: "bg-purple-100 text-purple-700",
};

const PLAN_HIGHLIGHT_HEADER: Record<OperatorPlan, string> = {
  free:       "bg-gray-100 text-gray-700",
  pro:        "bg-amber-100 text-amber-700",
  premium:    "bg-blue-100 text-blue-700",
  enterprise: "bg-purple-100 text-purple-700",
};

const PLAN_HIGHLIGHT_CELL: Record<OperatorPlan, string> = {
  free:       "bg-gray-50 font-semibold text-gray-800",
  pro:        "bg-amber-50 font-semibold text-gray-800",
  premium:    "bg-blue-50 font-semibold text-gray-800",
  enterprise: "bg-purple-50 font-semibold text-gray-800",
};

const ANALYTICS_SHORT: Record<AnalyticsTier, string> = {
  basic:    "Basic",
  expanded: "Expanded",
  advanced: "Advanced",
};

// ── Feature rows (sourced from plans.ts helpers where applicable) ─────────────

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
    row("Users",                               (p) => formatLimit(maxUsers(p))),
    row("Images",                              (p) => formatLimit(maxImages(p))),
    row("Food Specials",                       (p) => formatLimit(maxFoodSpecials(p))),
    row("Drink Specials",                      (p) => formatLimit(maxDrinkSpecials(p))),
    row("Events",                              (p) => canUseRecurringEvents(p) ? "Recurring events" : "One-time events"),
    row("Advanced Search with Tags",           (p) => formatLimit(maxSearchTags(p))),
    row("Analytics",                           (p) => ANALYTICS_SHORT[analyticsTier(p)]),
    row("Featured Placement on Discover Page", (p) => p === "premium" ? "Included" : "—"),
    row("Promotional Campaigns",               (p) => canUsePromotionalCampaigns(p) ? "Included" : "—"),
  ];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { operator, operatorError } = await resolveOperatorContext();

  const plan = parseOperatorPlan(operator?.plan);
  const featureRows = buildFeatureRows();

  return (
    <div className="max-w-3xl">

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Billing</h2>
        <p className="text-sm text-gray-500">
          Your current plan and available options.
        </p>
      </div>

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {operatorError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}

      {/* ── Current Plan card ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
          Current Plan
        </p>
        <div className="flex items-center gap-2.5 mb-2">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${PLAN_BADGE_STYLES[plan]}`}
          >
            {PLAN_LABELS[plan]}
          </span>
        </div>
        <p className="text-sm text-gray-600">{PLAN_DESCRIPTIONS[plan]}</p>
      </div>

      {/* ── Plan Comparison ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Plan Comparison</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Your current plan is highlighted.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-36" />
                {VISIBLE_PLANS.map((p) => (
                  <th
                    key={p}
                    className={`px-4 py-3 text-center w-28 ${
                      p === plan ? PLAN_HIGHLIGHT_HEADER[p] : ""
                    }`}
                  >
                    <span className="flex flex-col items-center gap-0.5">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wide ${
                          p === plan ? "" : "text-gray-400"
                        }`}
                      >
                        {PLAN_LABELS[p]}
                      </span>
                      {p === plan && (
                        <span className="text-[10px] font-medium normal-case tracking-normal text-gray-500">
                          Current
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureRows.map((row, i) => (
                <tr
                  key={row.label}
                  className={`border-b border-gray-50 last:border-b-0 ${
                    i % 2 === 1 ? "bg-gray-50/40" : ""
                  }`}
                >
                  <td className="px-5 py-3 text-xs font-medium text-gray-600 whitespace-nowrap">
                    {row.label}
                  </td>
                  {VISIBLE_PLANS.map((p) => (
                    <td
                      key={p}
                      className={`px-4 py-3 text-center text-xs ${
                        p === plan
                          ? PLAN_HIGHLIGHT_CELL[p]
                          : "text-gray-400"
                      }`}
                    >
                      {row.values[p]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Upgrade Options ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">
          Upgrade Options
        </h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          Upgrade and downgrade options will be available here soon.
        </p>
      </div>

    </div>
  );
}
