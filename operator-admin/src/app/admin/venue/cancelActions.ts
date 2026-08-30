"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { createAdminClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auditLog";
import { getVenueSubscription, updateVenuePlan } from "@/lib/venueSubscriptions";
import { getStripeClient } from "@/lib/stripe";
import { logPlanChangeEvent } from "@/lib/planChangeEvents";
import { sendVenueCancellationFounderEmail, CANCELLATION_REASON_LABELS } from "@/lib/email";
import { getMembershipRole } from "@/lib/memberships";
import { sendSlackAcquisitionNotification } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CancellationReason =
  | "business_closed"
  | "not_interested"
  | "duplicate_listing"
  | "not_enough_value"
  | "other";

export type CancelVenueState = {
  success?: true;
  error?: string;
  /**
   * Set only when the venue was successfully cancelled/unpublished but the
   * subsequent entitlement downgrade (DB write, or the Stripe cancellation
   * call for a Stripe-backed venue) failed. The cancellation itself is real
   * and is never rolled back or misrepresented — this exists so the caller
   * can't collapse that outcome into either a false "nothing happened"
   * error or a false complete success. Either failure path already reports
   * critically (Sentry + #ops-critical) with its own HHC reference —
   * hhcErrorId below propagates that same reference; it is never
   * regenerated here.
   */
  downgradeFailed?: true;
  hhcErrorId?: string;
};

type VenueRow = {
  id: string;
  name: string;
  created_by_operator_id: string | null;
  cancelled_at: string | null;
  is_published: boolean | null;
};

const VENUE_CANCELLATION_FLOW = "venue-cancellation";

// ── Action ─────────────────────────────────────────────────────────────────────

/**
 * Cancels (unpublishes) a single venue and downgrades ONLY that venue's
 * billing to Free. Phase 2B: fully venue-scoped — cancelling Venue A never
 * touches Venue B's plan, Stripe customer, or subscription, even when both
 * belong to the same operator.
 *
 * Stripe cancellation correctness (Phase 2B fix — see the task's Part 15):
 * the pre-Phase-2B version of this action only ever flipped the local plan
 * column to Free; it never actually cancelled the real Stripe subscription,
 * so a Stripe-backed venue's card kept being charged indefinitely after
 * "cancellation." This version calls stripe.subscriptions.cancel() for a
 * Stripe-backed venue — billing genuinely stops. The resulting
 * customer.subscription.deleted webhook (not this action) is the actual
 * writer of venue_subscriptions.plan_code=free/status=cancelled and the
 * plan_change_events row for that transition, exactly like every other
 * Stripe-driven plan change in this codebase (checkout activation is also
 * only ever written by the webhook, never by the action that initiates it).
 * A MANUAL (non-Stripe) paid plan has no Stripe object to cancel, so it is
 * still downgraded directly via updateVenuePlan() here, as before.
 *
 * The venue's Stripe Customer itself is never deleted — only the
 * subscription is cancelled — so the venue can reuse it for a future
 * Checkout without losing payment-method history (see Part 5/7 of the task:
 * "no special reactivation feature," a cancelled venue just starts a normal
 * Checkout again).
 */
export async function cancelVenueAction(
  _prevState: CancelVenueState,
  formData: FormData
): Promise<CancelVenueState> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  // Cancelling the venue is owner-only — same rule as plan changes
  // (changePlanAction) and billing management (createPortalSessionAction).
  // Members may view the subscription page but cannot cancel the venue.
  // Impersonation sessions bypass this check, matching every other
  // owner-only action; the Cancel Venue UI is already hidden during
  // impersonation (see admin/subscription/page.tsx), so this only affects
  // non-owner operator members submitting a real request.
  if (!ctx.isImpersonating) {
    const userEmail = ctx.user?.email;
    if (!userEmail) return { error: "Could not determine current user." };
    if (!ctx.operator) return { error: "Could not resolve operator." };
    const role = await getMembershipRole(ctx.operator.id, userEmail);
    if (role !== "owner") {
      return { error: "Only the admin can cancel the venue." };
    }
  }

  const venueId = formData.get("venue_id") as string | null;
  const reason  = (formData.get("reason") as CancellationReason | null) ?? "other";

  if (!venueId) return { error: "Venue ID is required." };

  const adminClient = createAdminClient();

  // ── Verify ownership ───────────────────────────────────────────────────────
  let venueQuery = adminClient
    .from("venues")
    .select("id, name, created_by_operator_id, cancelled_at, is_published")
    .eq("id", venueId);

  if (ctx.operator) {
    venueQuery = venueQuery.eq("created_by_operator_id", ctx.operator.id);
  }

  const { data: venueData, error: venueError } = await venueQuery.maybeSingle();

  if (venueError || !venueData) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  const venue = venueData as unknown as VenueRow;

  if (venue.cancelled_at) {
    return { error: "This venue has already been cancelled." };
  }

  const operatorId = ctx.operator?.id ?? venue.created_by_operator_id;
  const actorEmail = ctx.operator?.email ?? "unknown";
  const now        = new Date().toISOString();

  // ── Cancel + unpublish ─────────────────────────────────────────────────────
  const { error: updateError } = await adminClient
    .from("venues")
    .update({
      is_published:             false,
      cancelled_at:             now,
      cancellation_reason:      reason,
      cancelled_by_operator_id: operatorId,
    })
    .eq("id", venueId);

  if (updateError) {
    console.error("[cancelVenueAction] Update failed:", updateError.message);
    return { error: "Failed to cancel venue. Please try again." };
  }

  // ── Internal venue note ────────────────────────────────────────────────────
  await adminClient.from("venue_notes").insert({
    venue_id:         venueId,
    note:             `Venue management cancelled by operator. Reason: ${reason}. Venue unpublished.`,
    created_by:       null,
    created_by_email: actorEmail,
  });

  // ── Billing: downgrade THIS VENUE to free if it's on a paid plan ──────────
  // previousPlan is hoisted to this scope (rather than re-fetched) so the
  // #venue-churn Slack notification below can report it.
  //
  // downgradeFailed/downgradeHhcErrorId: the venue cancellation above has
  // already happened and is never rolled back — if the downgrade/Stripe
  // cancellation itself fails, this action must not claim it didn't (a
  // false "error, nothing happened" response) or that everything succeeded
  // (a false-success response). Both failure paths below already report
  // critically with their own HHC reference; it is propagated below, never
  // regenerated.
  let previousPlan = "free";
  let downgradeFailed = false;
  let downgradeHhcErrorId: string | undefined;

  const subscription = await getVenueSubscription(venueId);
  previousPlan = subscription?.plan_code ?? "free";

  if (previousPlan !== "free") {
    const isStripeBacked =
      subscription?.billing_provider === "stripe" &&
      !!subscription.billing_provider_subscription_id;

    if (isStripeBacked) {
      // Actually cancel at Stripe — billing genuinely stops. Do NOT also
      // write venue_subscriptions here: the resulting
      // customer.subscription.deleted webhook is the sole writer of the
      // downgrade + plan_change_events row for this transition, exactly
      // like every other Stripe-driven plan change in this codebase.
      try {
        const stripe = getStripeClient();
        await stripe.subscriptions.cancel(subscription!.billing_provider_subscription_id!);
      } catch (e) {
        console.error("[cancelVenueAction] Stripe subscription cancellation failed:", e);
        const report = await reportCriticalFailure({
          error: e,
          flow: VENUE_CANCELLATION_FLOW,
          stage: "stripe-subscription-cancel",
          title: "Venue Cancellation: Stripe Cancel Failed",
          technicalSummary: "venue unpublished but the real Stripe subscription was not cancelled — billing may continue",
          context: {
            venueId,
            operatorId,
            stripeSubscriptionId: subscription!.billing_provider_subscription_id,
          },
          slackFields: {
            "Venue ID": venueId,
            "Stripe Subscription": subscription!.billing_provider_subscription_id ?? "unknown",
          },
        });
        downgradeFailed = true;
        downgradeHhcErrorId = report.hhcErrorId;
      }
    } else {
      // Manual (non-Stripe) paid plan — no Stripe object exists; downgrade
      // this venue directly.
      const result = await updateVenuePlan(venueId, "free");
      if (result.ok) {
        await logPlanChangeEvent({
          operatorId,
          venueId,
          fromPlan:       previousPlan,
          toPlan:         "free",
          changedByEmail: actorEmail,
          trigger:        "operator_venue_cancellation",
        });
      } else {
        // Do not log a plan-change event or fire the #venue-plan-changes/
        // #venue-churn "previous plan" framing as if the downgrade
        // succeeded — it didn't. #venue-churn below still fires (the venue
        // WAS cancelled), but previousPlan is still reported accurately
        // since the plan did NOT actually change.
        downgradeFailed = true;
        downgradeHhcErrorId = result.hhcErrorId;
      }
    }
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  await logAuditEvent({
    actorEmail,
    action:     "operator_venue_cancelled",
    entityType: "venue",
    entityId:   venueId,
    entityName: venue.name,
    details:    { reason, operator_id: operatorId },
  });

  // ── Notify founder (fire-and-forget) ──────────────────────────────────────
  sendVenueCancellationFounderEmail({
    venueName:     venue.name,
    operatorEmail: actorEmail,
    reason,
    venueId,
  }).catch(err =>
    console.error("[cancelVenueAction] Founder notification failed:", err)
  );

  // ── Notify #venue-churn Slack channel (fire-and-forget, best-effort) ──────
  const venueUrl     = `${getSiteUrl()}/control-panel/venues/${venueId}`;
  const reasonLabel  = CANCELLATION_REASON_LABELS[reason] ?? reason;
  const environment  = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const operatorName = ctx.operator?.name ?? null;

  const churnLines = [
    `*${venue.name}* — venue management cancelled`,
    `*Venue ID:* ${venueId}`,
    `*Operator:* ${operatorName ? `${operatorName} (${actorEmail})` : actorEmail}`,
    `*Reason:* ${reasonLabel}`,
    `*Previous plan:* ${previousPlan}`,
    `*Was published:* ${venue.is_published ? "Yes" : "No"}`,
    `*Cancelled:* ${new Date(now).toUTCString()}`,
    `<${venueUrl}|Open in Control Panel →>`,
  ];
  if (environment !== "production") churnLines.unshift(`⚠️ *[${environment}]*`);

  sendSlackAcquisitionNotification({
    channel: "venue-churn",
    text:    churnLines.join("\n"),
  }).catch(err =>
    console.error("[cancelVenueAction] Slack churn notification failed:", err)
  );

  return downgradeFailed
    ? { success: true, downgradeFailed: true, hhcErrorId: downgradeHhcErrorId }
    : { success: true };
}
