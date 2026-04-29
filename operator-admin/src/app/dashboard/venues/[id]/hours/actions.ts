"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { DAYS_OF_WEEK, to24h } from "../../_shared/hoursUtils";
import type {
  BusinessHours,
  BusinessHoursFormState,
  DayOfWeek,
} from "../../_shared/types";

export type UpdateBusinessHoursState = BusinessHoursFormState;

/**
 * Server action to update a venue's business_hours JSONB column.
 *
 * `venueId` is bound via `.bind(null, venueId)` in the client component —
 * it is never read from FormData.
 *
 * Impersonation-aware: delegates operator resolution to resolveOperatorContext(),
 * which returns the admin client + impersonated operator when a valid
 * imp_session_id cookie is present.
 */
export async function updateBusinessHoursAction(
  venueId: string,
  _prevState: UpdateBusinessHoursState,
  formData: FormData
): Promise<UpdateBusinessHoursState> {
  // ── Parse & validate each day ─────────────────────────────────────────────
  const hours: BusinessHours = {};
  const errors: Partial<Record<DayOfWeek | "form", string>> = {};

  for (const day of DAYS_OF_WEEK) {
    const closed = formData.get(`${day}_closed`) === "on";

    if (closed) {
      hours[day] = null;
      continue;
    }

    const openHour   = (formData.get(`${day}_open_hour`)    as string | null) ?? "9";
    const openMinute = (formData.get(`${day}_open_minute`)  as string | null) ?? "00";
    const openPeriod = (formData.get(`${day}_open_period`)  as string | null) ?? "AM";
    const closeHour   = (formData.get(`${day}_close_hour`)   as string | null) ?? "10";
    const closeMinute = (formData.get(`${day}_close_minute`) as string | null) ?? "00";
    const closePeriod = (formData.get(`${day}_close_period`) as string | null) ?? "PM";

    const open  = to24h(openHour,  openMinute,  openPeriod);
    const close = to24h(closeHour, closeMinute, closePeriod);

    if (open === close) {
      errors[day] = "Opening and closing times cannot be the same.";
      hours[day] = { open, close };
      continue;
    }

    hours[day] = { open, close };
  }

  if (Object.keys(errors).length > 0) {
    return { errors, hours };
  }

  // ── Resolve operator context (impersonation-aware) ─────────────────────────
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: {
        form: ctx.operatorError ?? "Could not resolve your operator account. Try refreshing the page.",
      },
      hours,
    };
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  const updates = {
    business_hours: hours,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  let q = ctx.supabase
    .from("venues")
    .update(updates, { count: "exact" })
    .eq("id", venueId);

  if (ctx.operator) {
    q = q.eq("created_by_operator_id", ctx.operator.id);
  }

  const { error: updateError, count } = await q;

  if (updateError) {
    console.error("[updateBusinessHoursAction] Update failed:", updateError);
    return {
      errors: { form: `Failed to save hours: ${updateError.message}` },
      hours,
    };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
      hours,
    };
  }

  return { success: true, hours };
}
