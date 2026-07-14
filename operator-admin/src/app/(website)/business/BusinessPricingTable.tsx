import { PLAN_LABELS } from "@/lib/plans";
import {
  VISIBLE_PLANS,
  PLAN_SUBTITLES,
  PLAN_PRICES,
  PLAN_KEY_BENEFITS,
  buildFeatureRows,
  type VisiblePlan,
} from "@/lib/planPresentation";
import { BusinessListVenueButton } from "./BusinessListVenueButton";

/**
 * Public Free/Pro/Premium pricing matrix (Business Funnel Blueprint,
 * Section 7). Reads plan copy and entitlements from the same
 * src/lib/planPresentation.ts + src/lib/plans.ts data the operator admin's
 * ChangePlanModal uses, so this table can never drift from what a venue
 * actually gets after signing up. Enterprise is intentionally not shown
 * here — same self-serve boundary ChangePlanModal already draws.
 *
 * Every card's CTA opens the same venue-onboarding flow: pricing here
 * exists to remove the barrier to joining, not to sell a specific tier —
 * operators choose/upgrade their plan later, from inside Operator Admin.
 */

const CARD_CTA_CLASS =
  "mt-2 w-full inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-semibold transition-colors bg-gray-900 hover:bg-gray-800 text-white";

export function BusinessPricingTable() {
  const featureRows = buildFeatureRows();

  return (
    <section aria-label="Pricing" className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
          Simple, Transparent Pricing
        </h2>
        <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
          Our Free plan is a permanent plan — not a free trial. There&apos;s no credit card
          required, no contracts, and no pressure to upgrade. Start for free today, and upgrade
          later if and when your business needs additional features.
        </p>
      </div>

      {/* Plan cards */}
      <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-5">
        {VISIBLE_PLANS.map((plan) => (
          <PlanCard key={plan} plan={plan} />
        ))}
      </div>

      {/* Comparison table */}
      <div className="mt-14">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Plan Comparison</h3>
        <p className="text-sm text-gray-500 mb-5">
          A detailed breakdown of what&apos;s included in each plan.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-gray-200">
          <table className="w-full min-w-[560px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-44" />
                {VISIBLE_PLANS.map((plan) => (
                  <th key={plan} className="px-4 py-3 text-center w-32">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                      {PLAN_LABELS[plan]}
                    </span>
                  </th>
                ))}
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
                  {VISIBLE_PLANS.map((plan) => (
                    <td key={plan} className="px-4 py-3 text-center text-xs text-gray-600">
                      {row.values[plan]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PlanCard({ plan }: { plan: VisiblePlan }) {
  const isFree = plan === "free";

  return (
    <div className="relative flex flex-col rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] overflow-hidden">
      {isFree && (
        <div className="absolute top-4 right-4">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            Great Place to Start
          </span>
        </div>
      )}

      <div className="px-6 pt-6 pb-4">
        <h3 className="text-xl font-bold text-gray-900">{PLAN_LABELS[plan]}</h3>
        <p className="mt-1 text-xs text-gray-500 leading-snug pr-16 min-h-[2.5rem]">
          {PLAN_SUBTITLES[plan]}
        </p>
        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900">{PLAN_PRICES[plan]}</span>
          <span className="text-sm text-gray-400">/month</span>
        </div>
      </div>

      <div className="px-6 py-5 flex-1 border-t border-gray-100">
        <ul className="space-y-2.5">
          {PLAN_KEY_BENEFITS[plan].map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckIcon />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-6 pb-6">
        <BusinessListVenueButton className={CARD_CTA_CLASS}>
          Get Started
        </BusinessListVenueButton>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 shrink-0 mt-0.5 text-amber-500"
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
