import { createAdminClient } from "@/lib/supabase/server";
import { PLANS, parseOperatorPlan } from "@/lib/plans";
import { getOperatorVenues } from "@/lib/getOperatorVenues";
import { sendSlackAcquisitionNotification } from "@/lib/slack";
import { sendPlanChangeFounderEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";

export interface PlanChangeEventPayload {
  operatorId:                     string;
  fromPlan:                       string;
  toPlan:                         string;
  changedByEmail?:                string | null;
  /** manual_admin | impersonation | stripe_checkout | stripe_subscription_updated | stripe_subscription_deleted | operator_venue_cancellation */
  trigger:                        string;
  billingProviderSubscriptionId?: string | null;
  /**
   * Stripe customer ID, when this change originated from a Stripe webhook.
   * Used only for the founder notification below — not persisted to
   * plan_change_events (no column for it), matching the existing table shape.
   */
  billingProviderCustomerId?:     string | null;
}

/**
 * Triggers that already send their own dedicated founder notification
 * elsewhere in the app — skipped by notifyFounderOfPlanChange() below to
 * avoid a duplicate notification for the same underlying event.
 *
 *   operator_venue_cancellation — cancelVenueAction (src/app/admin/venue/
 *   cancelActions.ts) already sends sendVenueCancellationFounderEmail() and a
 *   #venue-churn Slack message covering this exact downgrade-to-free.
 */
const TRIGGERS_WITH_OWN_NOTIFICATION = new Set(["operator_venue_cancellation"]);

/**
 * Appends a row to plan_change_events, then attempts the founder Slack +
 * email notification for the same change. Always call after the plan change
 * succeeds — never before, and never on a failed/abandoned attempt.
 *
 * Supplements (does not replace) audit_logs — both should be written for
 * manual plan changes.
 *
 * This function itself never throws: the audit-log insert and the
 * notification attempt are each wrapped in their own try/catch, so a
 * Supabase, Slack, or email failure is logged but never propagates to the
 * caller. All five call sites (changePlanAction, the three plan-changing
 * Stripe webhook branches, and cancelVenueAction) already `await` this
 * function as part of a request/webhook handler that must not fail merely
 * because a downstream notification failed — see notifyFounderOfPlanChange()
 * below, which is awaited here (rather than fired-and-forgotten) specifically
 * so the Slack/email attempts are guaranteed to run to completion before the
 * caller's request lifecycle ends, instead of racing a serverless function's
 * teardown.
 */
export async function logPlanChangeEvent(payload: PlanChangeEventPayload): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("plan_change_events").insert({
      operator_id:                      payload.operatorId,
      from_plan:                        payload.fromPlan,
      to_plan:                          payload.toPlan,
      changed_by_email:                 payload.changedByEmail                ?? null,
      trigger:                          payload.trigger,
      billing_provider_subscription_id: payload.billingProviderSubscriptionId ?? null,
    });
    if (error) {
      console.error("[logPlanChangeEvent] Insert failed:", error.message, {
        trigger:    payload.trigger,
        fromPlan:   payload.fromPlan,
        toPlan:     payload.toPlan,
        operatorId: payload.operatorId,
      });
    }
  } catch (err) {
    console.error("[logPlanChangeEvent] Unexpected error:", err);
  }

  try {
    await notifyFounderOfPlanChange(payload);
  } catch (err) {
    console.error("[logPlanChangeEvent] Founder plan-change notification failed:", err);
  }
}

/**
 * Sends the founder Slack (#venue-plan-changes) and email notification for a
 * confirmed plan change. Awaited by logPlanChangeEvent() — but Slack and
 * email are each attempted independently via Promise.allSettled, so one
 * failing never prevents or delays the other, and neither can reject this
 * function (each already resolves to a logged failure instead of throwing).
 */
async function notifyFounderOfPlanChange(payload: PlanChangeEventPayload): Promise<void> {
  if (TRIGGERS_WITH_OWN_NOTIFICATION.has(payload.trigger)) return;

  const fromPlan = parseOperatorPlan(payload.fromPlan);
  const toPlan   = parseOperatorPlan(payload.toPlan);
  if (fromPlan === toPlan) return; // not a real change — nothing to notify

  const isUpgrade = PLANS.indexOf(toPlan) > PLANS.indexOf(fromPlan);

  const supabase = createAdminClient();
  const [{ data: operatorRow }, { venues }] = await Promise.all([
    supabase.from("operators").select("email").eq("id", payload.operatorId).maybeSingle(),
    getOperatorVenues(supabase, payload.operatorId),
  ]);

  const operatorEmail =
    (operatorRow as { email: string } | null)?.email ?? payload.changedByEmail ?? "unknown";
  const venue = venues[0] ?? null;

  // ── Slack ──────────────────────────────────────────────────────────────
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const emoji        = isUpgrade ? "🎉" : "⚠️";
  const changeLabel  = isUpgrade ? "Plan Upgrade" : "Plan Downgrade";
  const venueUrl     = venue ? `${getSiteUrl()}/control-panel/venues/${venue.id}` : null;

  const lines = [
    `${emoji} *${changeLabel}* — ${venue?.name ?? "(no venue on file)"}`,
    `*Venue ID:* ${venue?.id ?? "—"}`,
    `*Operator:* ${operatorEmail}`,
    `*Plan:* ${fromPlan} → ${toPlan}`,
    `*Trigger:* ${payload.trigger}`,
    `*Effective:* ${new Date().toUTCString()} · Immediate`,
    ...(payload.billingProviderSubscriptionId ? [`*Stripe subscription:* ${payload.billingProviderSubscriptionId}`] : []),
    ...(payload.billingProviderCustomerId ? [`*Stripe customer:* ${payload.billingProviderCustomerId}`] : []),
    ...(venueUrl ? [`<${venueUrl}|Open in Control Panel →>`] : []),
  ];
  if (environment !== "production") lines.unshift(`⚠️ *[${environment}]*`);

  // Promise.allSettled (rather than Promise.all): a Slack failure must not
  // prevent the email attempt, and vice versa. Each promise already resolves
  // (never rejects) via its own .catch(), so allSettled is a belt-and-braces
  // guarantee that both attempts always run to completion — neither can
  // starve the other regardless of how sendSlackAcquisitionNotification /
  // sendPlanChangeFounderEmail behave in the future.
  await Promise.allSettled([
    sendSlackAcquisitionNotification({
      channel: "venue-plan-changes",
      text:    lines.join("\n"),
    }).catch(err =>
      console.error("[logPlanChangeEvent] Slack plan-change notification failed:", err)
    ),

    sendPlanChangeFounderEmail({
      venueName:                     venue?.name ?? null,
      venueId:                       venue?.id ?? null,
      operatorEmail,
      fromPlan,
      toPlan,
      isUpgrade,
      billingProviderSubscriptionId: payload.billingProviderSubscriptionId ?? null,
      billingProviderCustomerId:     payload.billingProviderCustomerId ?? null,
    }).catch(err =>
      console.error("[logPlanChangeEvent] Founder plan-change email failed:", err)
    ),
  ]);
}
