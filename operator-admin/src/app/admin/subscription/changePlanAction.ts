"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { getMembershipRole } from "@/lib/memberships";
import { getVenueSubscription, updateVenuePlan } from "@/lib/venueSubscriptions";
import { getStripeClient, getStripePriceId, isStripeBillablePlan } from "@/lib/stripe";
import { parseOperatorPlan, PLAN_LABELS, type OperatorPlan } from "@/lib/plans";
import { revalidatePath } from "next/cache";
import { addSystemVenueNote } from "@/lib/data/venueNotes";
import { logAuditEvent } from "@/lib/auditLog";
import { logPlanChangeEvent } from "@/lib/planChangeEvents";
import { createAdminClient } from "@/lib/supabase/server";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";

// Finalize-review fix: this action previously wrote plan_code directly for
// EVERY transition, including a downgrade (or founder-manual change) away
// from a plan the venue was actually paying for via a real, active Stripe
// subscription — leaving that subscription untouched, still billing the
// operator at the old price indefinitely while the DB silently showed the
// new (lower, or different) plan. This is the exact same class of defect
// the Phase 2B billing review already found and fixed in cancelActions.ts
// for full venue cancellation — this file is the OTHER, more commonly-used
// path into the same gap (any downgrade via the Change Plan modal, or the
// "Switch to Free Plan" quick-action). Same fix, same pattern.
const VENUE_PLAN_CHANGE_FLOW = "venue-plan-change";

/**
 * Manually changes the ACTIVE VENUE's plan (non-Stripe-Checkout transitions:
 * any downgrade, and any impersonation/founder-triggered manual change).
 * Paid UPGRADES to pro/premium route through Stripe Checkout instead (see
 * createCheckoutSessionAction) — plan_code for those is only ever activated
 * by the webhook, never by this action.
 *
 * Phase 2B: takes no venue/operator parameter at all — the billed/changed
 * entity is the server-resolved ctx.activeVenueId, exactly like the Stripe
 * actions. Never trusts a client-supplied id. This IS the "manual/Control
 * Panel plan change" path — a founder changes a plan by impersonating into
 * the specific venue first (Case A), which fixes ctx.activeVenueId to that
 * venue for the whole session; there is no separate unauthenticated
 * "change any operator's plan" action.
 *
 * Stripe correctness (finalize-review fix — see the constant comment
 * above): if the venue currently has a REAL, active Stripe-backed
 * subscription, this action keeps Stripe in sync with whatever DB change
 * it's about to make, exactly like cancelActions.ts:
 *   - target plan is not Stripe-billable (e.g. → free): the real
 *     subscription is CANCELLED immediately. The DB downgrade is written
 *     exclusively by the resulting customer.subscription.deleted webhook —
 *     this function does NOT also call updateVenuePlan() or
 *     logPlanChangeEvent() itself for that transition, to avoid a double
 *     write racing the webhook (exactly like cancelVenueAction's
 *     Stripe-backed branch).
 *   - target plan IS Stripe-billable and differs from the current one
 *     (e.g. premium → pro): the real subscription's PRICE is updated in
 *     place (proration_behavior: "none" — matches the product's existing
 *     "no automatic refund/proration" policy, see cancelActions.ts). The DB
 *     update is written exclusively by the resulting
 *     customer.subscription.updated webhook.
 *   - the venue has NO active Stripe subscription (a founder manually
 *     granting/adjusting a plan with no real payment involved, or the venue
 *     is already Free/manual): unchanged — a direct DB write via
 *     updateVenuePlan(), audited and logged here as before.
 */
export async function changePlanAction(
  newPlan: OperatorPlan
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator && !ctx.isImpersonating) {
    return { ok: false, error: "Not authenticated." };
  }

  const operatorId = ctx.operator?.id ?? null;

  // Plan changes are owner-only. Members may view the subscription page but
  // cannot change the plan. Impersonation sessions bypass this check.
  if (!ctx.isImpersonating) {
    if (!operatorId) return { ok: false, error: "Could not resolve operator." };
    const userEmail = ctx.user?.email;
    if (!userEmail) return { ok: false, error: "Could not determine current user." };

    const role = await getMembershipRole(operatorId, userEmail);
    if (role !== "owner") {
      return { ok: false, error: "Only the admin can change the plan." };
    }
  }

  const activeVenueId = ctx.activeVenueId;
  if (!activeVenueId) {
    return { ok: false, error: "No active venue selected. Please select a venue first." };
  }

  const targetPlan   = parseOperatorPlan(newPlan);
  const subscription = await getVenueSubscription(activeVenueId);
  const oldPlan       = subscription?.plan_code ?? "free";

  if (targetPlan === oldPlan) {
    // Nothing to do — the UI already disables selecting the current plan;
    // this is a defensive no-op, not an error.
    return { ok: true };
  }

  const isCurrentlyStripeBacked =
    subscription?.billing_provider === "stripe" && !!subscription.billing_provider_subscription_id;

  if (isCurrentlyStripeBacked) {
    let stripe: ReturnType<typeof getStripeClient>;
    try {
      stripe = getStripeClient();
    } catch (e) {
      console.error("[changePlanAction] Stripe client error:", e instanceof Error ? e.message : e);
      const report = await reportCriticalFailure({
        error: e,
        flow: VENUE_PLAN_CHANGE_FLOW,
        stage: "plan-change-precondition",
        title: "Venue Plan Change Blocked",
        technicalSummary: "Stripe client initialization failed",
        context: { operatorId, venueId: activeVenueId, oldPlan, targetPlan },
        slackFields: { "Venue ID": activeVenueId, "From Plan": oldPlan, "To Plan": targetPlan },
      });
      return { ok: false, error: report.customerMessage };
    }

    const subscriptionId = subscription!.billing_provider_subscription_id!;

    if (!isStripeBillablePlan(targetPlan)) {
      // Moving OFF Stripe billing entirely — cancel the real subscription
      // immediately. Do NOT also call updateVenuePlan()/logPlanChangeEvent()
      // here: the resulting customer.subscription.deleted webhook is the
      // sole writer for this transition, exactly like cancelVenueAction's
      // Stripe-backed branch — never both.
      try {
        await stripe.subscriptions.cancel(subscriptionId);
      } catch (e) {
        console.error("[changePlanAction] Stripe subscription cancellation failed:", e instanceof Error ? e.message : e);
        const report = await reportCriticalFailure({
          error: e,
          flow: VENUE_PLAN_CHANGE_FLOW,
          stage: "plan-change-stripe-cancel",
          title: "Venue Plan Change Blocked",
          technicalSummary: "Stripe subscription cancellation failed while downgrading off Stripe billing",
          context: { operatorId, venueId: activeVenueId, oldPlan, targetPlan, stripeSubscriptionId: subscriptionId },
          slackFields: { "Venue ID": activeVenueId, "Stripe Subscription": subscriptionId },
        });
        return { ok: false, error: report.customerMessage };
      }
      revalidatePath("/admin/subscription");
      return { ok: true };
    }

    // Staying on Stripe billing but changing tier (e.g. premium → pro) —
    // update the real subscription's price so billing actually reflects
    // the new tier. Do NOT touch the DB directly; the resulting
    // customer.subscription.updated webhook is the sole writer, matching
    // every other Stripe-driven change in this codebase.
    let newPriceId: string | null;
    try {
      newPriceId = getStripePriceId(targetPlan);
    } catch (e) {
      console.error("[changePlanAction] price ID error:", e instanceof Error ? e.message : e);
      const report = await reportCriticalFailure({
        error: e,
        flow: VENUE_PLAN_CHANGE_FLOW,
        stage: "plan-change-precondition",
        title: "Venue Plan Change Blocked",
        technicalSummary: "price ID misconfigured",
        context: { operatorId, venueId: activeVenueId, oldPlan, targetPlan },
        slackFields: { "Venue ID": activeVenueId, "To Plan": targetPlan },
      });
      return { ok: false, error: report.customerMessage };
    }
    if (!newPriceId) {
      return { ok: false, error: "No price configured for that plan." };
    }

    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
      const itemId = stripeSub.items.data[0]?.id;
      if (!itemId) {
        throw new Error("Stripe subscription has no line item to update");
      }
      // proration_behavior: "none" — matches the product's existing
      // "unused/prepaid time is not automatically refunded or prorated"
      // policy (see cancelActions.ts): the new price takes effect on the
      // subscription going forward without a mid-cycle credit or charge.
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: "none",
      });
    } catch (e) {
      console.error("[changePlanAction] Stripe subscription price update failed:", e instanceof Error ? e.message : e);
      const report = await reportCriticalFailure({
        error: e,
        flow: VENUE_PLAN_CHANGE_FLOW,
        stage: "plan-change-stripe-update",
        title: "Venue Plan Change Blocked",
        technicalSummary: "Stripe subscription price update failed while changing paid tier",
        context: { operatorId, venueId: activeVenueId, oldPlan, targetPlan, stripeSubscriptionId: subscriptionId },
        slackFields: { "Venue ID": activeVenueId, "Stripe Subscription": subscriptionId, "To Plan": targetPlan },
      });
      return { ok: false, error: report.customerMessage };
    }
    revalidatePath("/admin/subscription");
    return { ok: true };
  }

  // Not currently Stripe-backed (a founder manually granting/adjusting a
  // plan with no real payment involved, or the venue is already Free with
  // no subscription row) — direct DB write, unchanged from before.
  const result = await updateVenuePlan(activeVenueId, targetPlan);

  if (result.ok) {
    revalidatePath("/admin/subscription");
    const actorEmail = ctx.user?.email ?? ctx.operator?.email ?? null;

    const supabase = createAdminClient();
    const { data: venueRow } = await supabase
      .from("venues")
      .select("name")
      .eq("id", activeVenueId)
      .maybeSingle();
    const venueName = (venueRow as { name?: string } | null)?.name ?? "this venue";

    await addSystemVenueNote(
      operatorId ?? "",
      `Subscription changed from ${PLAN_LABELS[oldPlan]} to ${PLAN_LABELS[targetPlan]} by ${actorEmail ?? "unknown"}.`,
      actorEmail,
      activeVenueId
    );
    await logAuditEvent({
      actorEmail: actorEmail ?? "unknown",
      action:     "plan_changed",
      entityType: "venue",
      entityId:   activeVenueId,
      entityName: venueName,
      details: {
        from:        PLAN_LABELS[oldPlan]    ?? oldPlan,
        to:          PLAN_LABELS[targetPlan] ?? targetPlan,
        operator_id: operatorId,
      },
    });
    await logPlanChangeEvent({
      operatorId,
      venueId:        activeVenueId,
      fromPlan:       oldPlan,
      toPlan:         targetPlan,
      changedByEmail: actorEmail,
      trigger:        ctx.isImpersonating ? "impersonation" : "manual_admin",
    });
  }

  return result;
}
