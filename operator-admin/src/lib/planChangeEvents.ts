import { createAdminClient } from "@/lib/supabase/server";

export interface PlanChangeEventPayload {
  operatorId:                     string;
  fromPlan:                       string;
  toPlan:                         string;
  changedByEmail?:                string | null;
  /** manual_admin | impersonation | stripe_checkout | stripe_subscription_updated | stripe_subscription_deleted */
  trigger:                        string;
  billingProviderSubscriptionId?: string | null;
}

/**
 * Appends a row to plan_change_events. Fire-and-forget — errors are logged
 * but never surfaced. Always call after the plan change succeeds.
 *
 * Supplements (does not replace) audit_logs — both should be written for
 * manual plan changes.
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
}
