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
  "mt-2 w-full inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-semibold transition-colors bg-amber-500 hover:bg-amber-600 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2";

export function BusinessPricingTable() {
  const featureRows = buildFeatureRows();

  return (
    <section aria-label="Pricing" className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
          Simple Pricing. No Surprises.
        </h2>
        <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
          Our Free plan is a permanent plan—not a free trial.{" "}
          <strong className="font-semibold text-gray-700">No credit card required.</strong> No
          contracts. Upgrade later if and when your business needs additional features.
        </p>
      </div>

      {/* Plan cards */}
      <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {VISIBLE_PLANS.map((plan) => (
          <PlanCard key={plan} plan={plan} />
        ))}
      </div>

      {/* Comparison table */}
      <div className="mt-16">
        <div className="text-center mb-8">
          <h3 className="text-xl font-bold text-gray-900 tracking-tight">
            Compare every plan at a glance
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Simple pricing designed for hospitality businesses.
          </p>
        </div>
        {/* contain-layout keeps the table's min-width from being counted toward
            this page's layout width — without it, a wide table still leaks
            into the document's scrollWidth on narrow viewports even though
            overflow-x-auto correctly clips and scrolls it visually. */}
        <div className="contain-layout overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)]">
          <table className="w-full min-w-[600px] border-collapse table-fixed">
            <colgroup>
              <col className="w-40" />
              {VISIBLE_PLANS.map((plan) => (
                <col key={plan} className="w-36" />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b-2 border-gray-300">
                <th className="px-6 py-6 text-left" />
                {VISIBLE_PLANS.map((plan) => (
                  <th key={plan} className="px-4 py-6 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-base font-extrabold text-gray-900 tracking-wide">
                        {PLAN_LABELS[plan]}
                      </span>
                      <span className="flex items-baseline gap-0.5">
                        <span className="text-base font-bold text-gray-900">
                          {PLAN_PRICES[plan]}
                        </span>
                        <span className="text-xs text-gray-400">/month</span>
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureRows.map((row, i) => {
                const isPremiumExclusive =
                  row.values.premium === "Included" &&
                  row.values.free !== "Included" &&
                  row.values.pro !== "Included";
                return (
                  <tr key={row.label} className={i % 2 === 1 ? "bg-gray-100/70" : undefined}>
                    <td
                      className={`px-6 py-4 text-sm leading-snug ${
                        isPremiumExclusive
                          ? "font-semibold text-gray-900"
                          : "font-semibold text-gray-800"
                      }`}
                    >
                      {row.label}
                    </td>
                    {VISIBLE_PLANS.map((plan) => (
                      <td key={plan} className="px-4 py-4 text-center text-sm text-gray-700">
                        <FeatureValue value={row.values[plan]} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/**
 * Renders a comparison-table cell value. "Included" becomes a checkmark
 * (amber, matching the plan cards' own benefit checkmarks but a size up
 * and a shade darker — text-amber-600 vs the cards' text-amber-500 — so
 * these premium-exclusive rows are easy to spot on a quick scan) with the
 * word kept for screen readers via sr-only text; "—" is de-emphasized
 * rather than iconified, since a lone dash already reads clearly as "not
 * included" and every cell getting its own icon would be the "decorative
 * icons everywhere" the design brief asks to avoid. Every other value
 * (counts, "Unlimited", plan-specific labels like "Recurring events") is
 * left as plain text — it's the actual data, not a boolean.
 */
function FeatureValue({ value }: { value: string }) {
  if (value === "Included") {
    return (
      <span className="inline-flex items-center justify-center">
        <CheckIcon className="w-5 h-5 text-amber-600" />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  if (value === "—") {
    return (
      <span>
        <span className="text-gray-400" aria-hidden="true">
          —
        </span>
        <span className="sr-only">Not included</span>
      </span>
    );
  }
  return <span>{value}</span>;
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

function CheckIcon({ className = "w-4 h-4 mt-0.5 text-amber-500" }: { className?: string }) {
  return (
    <svg
      className={`shrink-0 ${className}`}
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
