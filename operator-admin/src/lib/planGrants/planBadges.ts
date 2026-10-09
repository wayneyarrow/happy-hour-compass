/**
 * Paid / non-paying status badges for Control Panel lists (Venue Funnel).
 * Pure, client-safe.
 *
 * Billing status and grant status are always shown SEPARATELY:
 *   - an actual paid subscription keeps its normal paid badge ("Pro Paid");
 *     a manual (non-Stripe) billing row is labelled as such, never "Paid";
 *   - a grant gets its own badge ("Premium Comp"), with "· Non-paying" ONLY
 *     when there is no paid billing plan at all;
 *   - a Pro payer with a Premium Comp shows both: "Pro Paid" + "Premium Comp".
 */

import { PLAN_LABELS, type OperatorPlan } from "@/lib/plans";
import { grantLabel, planRank, type EffectiveAccess } from "@/lib/planGrants/grantState";
import { lastAccessDateLabel } from "@/lib/planGrants/grantDates";
import { formatDate } from "@/lib/controlPanelDateTime";

export type BillingKind = "stripe" | "manual";

/** How a venue counts in paid reporting. Grants never count as paying. */
export type PaidStatus = "paying" | "manual" | "non_paying_grant" | null;

export type PlanBadge = {
  label: string;
  /** Plan used for colour; null = neutral. */
  tone: OperatorPlan | null;
  /** Secondary text, e.g. "Through Oct 9, 2026" / "No expiry". */
  detail: string | null;
};

export function describePlanBadges(input: {
  billingPlan: OperatorPlan;
  /** Only meaningful when billingPlan is paid. */
  billingKind: BillingKind;
  access: EffectiveAccess;
}): { badges: PlanBadge[]; paidStatus: PaidStatus } {
  const { billingPlan, billingKind, access } = input;
  const billingPaid = billingPlan !== "free";
  const badges: PlanBadge[] = [];

  if (billingPaid) {
    badges.push({
      label: billingKind === "stripe"
        ? `${PLAN_LABELS[billingPlan]} Paid`
        : `${PLAN_LABELS[billingPlan]} · Manual (not Stripe-billed)`,
      tone: billingPlan,
      detail: null,
    });
  }

  const grant = access.activeGrant;
  if (grant) {
    const superseded = billingPaid && planRank(billingPlan) >= planRank(grant.planCode);
    badges.push({
      label: superseded
        ? `${grantLabel(grant)} (superseded)`
        : billingPaid
        ? grantLabel(grant)
        : `${grantLabel(grant)} · Non-paying`,
      tone: superseded ? null : grant.planCode,
      detail: grant.endsAt ? `Through ${lastAccessDateLabel(grant.endsAt)}` : "No expiry",
    });
  } else if (access.scheduledGrant) {
    badges.push({
      label: `${grantLabel(access.scheduledGrant)} scheduled`,
      tone: null,
      detail: `Starts ${formatDate(access.scheduledGrant.startsAt)}`,
    });
  }

  if (!billingPaid && !grant) {
    badges.unshift({ label: PLAN_LABELS[access.effectivePlan], tone: access.effectivePlan, detail: null });
  }

  const paidStatus: PaidStatus = billingPaid
    ? billingKind === "stripe" ? "paying" : "manual"
    : grant
    ? "non_paying_grant"
    : null;

  return { badges, paidStatus };
}
