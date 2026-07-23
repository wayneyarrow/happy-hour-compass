"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { createAdminClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auditLog";
import { getOperatorSubscription, updateOperatorPlan } from "@/lib/subscriptions";
import { logPlanChangeEvent } from "@/lib/planChangeEvents";
import { sendVenueCancellationFounderEmail, CANCELLATION_REASON_LABELS } from "@/lib/email";
import { getMembershipRole } from "@/lib/memberships";
import { sendSlackAcquisitionNotification } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";

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
  is_published: boolean | null;
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

  // ── Billing: downgrade to free if on a paid plan ───────────────────────────
  // previousPlan is hoisted to this scope (rather than re-fetched) so the
  // #venue-churn Slack notification below can report it.
  let previousPlan = "free";
  if (operatorId) {
    const subscription = await getOperatorSubscription(operatorId);
    previousPlan = subscription?.plan_code ?? "free";

    if (previousPlan !== "free") {
      const { ok } = await updateOperatorPlan(operatorId, "free");
      if (ok) {
        await logPlanChangeEvent({
          operatorId,
          fromPlan:       previousPlan,
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

  return { success: true };
}
