"use server";

/**
 * Founder Control Panel — Comp / Trial grant management (Part 1).
 *
 * Every action re-verifies the signed-in user with isControlPanelAdmin()
 * before any read or write, and writes ONLY through the migration-109
 * SECURITY DEFINER functions (which lock the venue row and enforce every
 * grant rule authoritatively). Nothing here reads or writes
 * venue_subscriptions, plan_change_events, or Stripe — a grant is never a
 * subscription and never revenue.
 *
 * venueId is bound via .bind(null, venueId) — never read from FormData.
 */

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import { accessThroughEndIso, zonedMidnightIso } from "@/lib/planGrants/grantDates";
import { PLAN_LABELS } from "@/lib/plans";

export type PlanGrantActionState = { success: boolean; error?: string; message?: string };

const OUTCOME_MESSAGES: Record<string, string> = {
  invalid_plan:        "Choose Pro or Premium.",
  invalid_type:        "Choose Comp or Trial.",
  reason_required:     "An internal reason is required.",
  actor_required:      "Your session is missing an email address. Please sign in again.",
  venue_not_found:     "Venue not found.",
  venue_unclaimed:     "Grants are only available on claimed, operator-owned venues. The venue must be claimed first.",
  venue_cancelled:     "This venue is cancelled. Reactivate it before granting access.",
  trial_requires_end:  "A Trial requires an end date.",
  end_before_start:    "The last day of access must be on or after the start date.",
  open_grant_exists:   "This venue already has an active or scheduled grant. Extend or revoke it instead.",
  grant_not_found:     "Grant not found.",
  grant_revoked:       "This grant has already been revoked.",
  grant_ended:         "This grant has already ended.",
  stale:               "This grant was changed by someone else. Refresh and try again.",
  end_required:        "Choose the last day of access.",
  end_not_in_future:   "The new last day of access must be in the future and on or after the start date.",
  unchanged:           "That is already the grant's end date.",
};

async function getAdmin(): Promise<{ id: string; email: string } | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user?.email || !(await isControlPanelAdmin(user.email))) return null;
    return { id: user.id, email: user.email };
  } catch {
    return null;
  }
}

function text(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function revalidateGrantSurfaces(venueId: string) {
  revalidatePath(`/control-panel/venues/${venueId}`);
  revalidatePath("/control-panel/action-center");
  revalidatePath("/control-panel/action-center/reports/plan-grants");
  revalidatePath("/control-panel/venue-funnel");
}

async function venueName(venueId: string): Promise<string> {
  const { data } = await createAdminClient().from("venues").select("name").eq("id", venueId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? venueId;
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createPlanGrantAction(
  venueId: string,
  _prev: PlanGrantActionState,
  formData: FormData
): Promise<PlanGrantActionState> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired. Please sign in again." };

  const planCode = text(formData, "planCode");
  const grantType = text(formData, "grantType");
  const startMode = text(formData, "startMode");
  const startDate = text(formData, "startDate");
  const endDate = text(formData, "endDate");
  const reason = text(formData, "reason");

  if (planCode !== "pro" && planCode !== "premium") return { success: false, error: OUTCOME_MESSAGES.invalid_plan };
  if (grantType !== "comp" && grantType !== "trial") return { success: false, error: OUTCOME_MESSAGES.invalid_type };
  if (!reason) return { success: false, error: OUTCOME_MESSAGES.reason_required };

  let startsAt: string | null = null;
  if (startMode === "scheduled") {
    startsAt = zonedMidnightIso(startDate);
    if (!startsAt) return { success: false, error: "Choose a valid start date." };
    if (Date.parse(startsAt) <= Date.now()) {
      return { success: false, error: "A scheduled start must be a future date. Use “Start now” for immediate access." };
    }
  }

  let endsAt: string | null = null;
  if (endDate) {
    endsAt = accessThroughEndIso(endDate);
    if (!endsAt) return { success: false, error: "Choose a valid last day of access." };
  }
  if (grantType === "trial" && !endsAt) return { success: false, error: OUTCOME_MESSAGES.trial_requires_end };

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("create_venue_plan_grant", {
    p_venue_id:    venueId,
    p_plan_code:   planCode,
    p_grant_type:  grantType,
    p_starts_at:   startsAt,
    p_ends_at:     endsAt,
    p_reason:      reason,
    p_actor_email: admin.email,
  });
  if (error) {
    console.error("[createPlanGrantAction]", error.message);
    return { success: false, error: "Failed to create the grant. Please try again." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; grant_id?: string } | null;
  const outcome = row?.outcome ?? "unknown";
  if (outcome !== "created") {
    return { success: false, error: OUTCOME_MESSAGES[outcome] ?? "The grant could not be created." };
  }

  await logAuditEvent({
    actorEmail: admin.email,
    action:     "plan_grant_created",
    entityType: "venue",
    entityId:   venueId,
    entityName: await venueName(venueId),
    details:    { grant_id: row?.grant_id, plan: PLAN_LABELS[planCode], type: grantType, starts_at: startsAt ?? "now", ends_at: endsAt },
  });

  revalidateGrantSurfaces(venueId);
  return { success: true, message: startsAt ? "Grant scheduled." : "Access granted." };
}

// ── Extend / add expiry ───────────────────────────────────────────────────────

export async function changePlanGrantEndAction(
  venueId: string,
  grantId: string,
  expectedEndsAt: string | null,
  _prev: PlanGrantActionState,
  formData: FormData
): Promise<PlanGrantActionState> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired. Please sign in again." };

  const endDate = text(formData, "endDate");
  const note = text(formData, "note");
  const newEndsAt = endDate ? accessThroughEndIso(endDate) : null;
  if (!newEndsAt) return { success: false, error: OUTCOME_MESSAGES.end_required };

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("change_venue_plan_grant_end", {
    p_grant_id:         grantId,
    p_venue_id:         venueId,
    p_new_ends_at:      newEndsAt,
    p_expected_ends_at: expectedEndsAt,
    p_note:             note || null,
    p_actor_email:      admin.email,
  });
  if (error) {
    console.error("[changePlanGrantEndAction]", error.message);
    return { success: false, error: "Failed to update the grant. Please try again." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
  const outcome = row?.outcome ?? "unknown";
  if (!["extended", "expiry_added", "expiry_shortened"].includes(outcome)) {
    return { success: false, error: OUTCOME_MESSAGES[outcome] ?? "The grant could not be updated." };
  }

  await logAuditEvent({
    actorEmail: admin.email,
    action:     `plan_grant_${outcome}`,
    entityType: "venue",
    entityId:   venueId,
    entityName: await venueName(venueId),
    details:    { grant_id: grantId, previous_ends_at: expectedEndsAt, new_ends_at: newEndsAt },
  });

  revalidateGrantSurfaces(venueId);
  return { success: true, message: outcome === "expiry_added" ? "Expiry added." : "End date updated." };
}

// ── Revoke / cancel before start ──────────────────────────────────────────────

export async function revokePlanGrantAction(
  venueId: string,
  grantId: string,
  _prev: PlanGrantActionState,
  formData: FormData
): Promise<PlanGrantActionState> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired. Please sign in again." };

  const reason = text(formData, "reason");
  if (!reason) return { success: false, error: OUTCOME_MESSAGES.reason_required };

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("revoke_venue_plan_grant", {
    p_grant_id:    grantId,
    p_venue_id:    venueId,
    p_reason:      reason,
    p_actor_email: admin.email,
  });
  if (error) {
    console.error("[revokePlanGrantAction]", error.message);
    return { success: false, error: "Failed to revoke the grant. Please try again." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
  const outcome = row?.outcome ?? "unknown";
  if (outcome !== "revoked" && outcome !== "cancelled_before_start") {
    return { success: false, error: OUTCOME_MESSAGES[outcome] ?? "The grant could not be revoked." };
  }

  await logAuditEvent({
    actorEmail: admin.email,
    action:     `plan_grant_${outcome}`,
    entityType: "venue",
    entityId:   venueId,
    entityName: await venueName(venueId),
    details:    { grant_id: grantId, reason },
  });

  revalidateGrantSurfaces(venueId);
  return { success: true, message: outcome === "cancelled_before_start" ? "Scheduled grant cancelled." : "Grant revoked." };
}
