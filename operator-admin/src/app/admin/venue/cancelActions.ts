"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { createAdminClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auditLog";
import { getOperatorSubscription, updateOperatorPlan } from "@/lib/subscriptions";
import { logPlanChangeEvent } from "@/lib/planChangeEvents";
import { sendVenueCancellationFounderEmail } from "@/lib/email";

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
};

type VenueRow = {
  id: string;
  name: string;
  created_by_operator_id: string | null;
  cancelled_at: string | null;
};

// ── Action ─────────────────────────────────────────────────────────────────────

export async function cancelVenueAction(
  _prevState: CancelVenueState,
  formData: FormData
): Promise<CancelVenueState> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const venueId = formData.get("venue_id") as string | null;
  const reason  = (formData.get("reason") as CancellationReason | null) ?? "other";

  if (!venueId) return { error: "Venue ID is required." };

  const adminClient = createAdminClient();

  // ── Verify ownership ───────────────────────────────────────────────────────
  let venueQuery = adminClient
    .from("venues")
    .select("id, name, created_by_operator_id, cancelled_at")
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

  // ── Billing: downgrade to free if on a paid plan ───────────────────────────
  if (operatorId) {
    const subscription = await getOperatorSubscription(operatorId);
    const currentPlan  = subscription?.plan_code ?? "free";

    if (currentPlan !== "free") {
      const { ok } = await updateOperatorPlan(operatorId, "free");
      if (ok) {
        await logPlanChangeEvent({
          operatorId,
          fromPlan:       currentPlan,
          toPlan:         "free",
          changedByEmail: actorEmail,
          trigger:        "operator_venue_cancellation",
        });
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

  return { success: true };
}
