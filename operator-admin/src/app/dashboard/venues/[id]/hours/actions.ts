"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
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
 * Per-day fields follow the naming convention:
 *   ${day}_closed        — checkbox; "on" = closed, absent = open
 *   ${day}_open_hour     — "1"–"12"
 *   ${day}_open_minute   — "00" | "15" | "30" | "45"
 *   ${day}_open_period   — "AM" | "PM"
 *   ${day}_close_hour    — "1"–"12"
 *   ${day}_close_minute  — "00" | "15" | "30" | "45"
 *   ${day}_close_period  — "AM" | "PM"
 *
 * Validation rules:
 *   • open === close → invalid (a venue can't open and close at the same moment)
 *   • open > close  → valid overnight window (e.g. 22:00–02:00)
 *   • open < close  → normal same-day window
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

    // Time fields are only submitted when the day is not closed.
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
      // Still record the attempted times so the form can restore them.
      hours[day] = { open, close };
      continue;
    }

    hours[day] = { open, close };
  }

  if (Object.keys(errors).length > 0) {
    return { errors, hours };
  }

  // ── Auth + operator resolution ─────────────────────────────────────────────
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      errors: { form: "Your session has expired. Please sign in again." },
      hours,
    };
  }

  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

  if (operatorError || !operator) {
    return {
      errors: {
        form:
          operatorError ??
          "Could not resolve your operator account. Try refreshing the page.",
      },
      hours,
    };
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  // Dual ownership filter: id + created_by_operator_id.
  // If neither matches, count === 0 is returned — treated as a not-found error.
  const { error: updateError, count } = await supabase
    .from("venues")
    .update({ business_hours: hours }, { count: "exact" })
    .eq("id", venueId)
    .eq("created_by_operator_id", operator.id);

  if (updateError) {
    console.error("[updateBusinessHoursAction] Update failed:", updateError);
    return {
      errors: { form: `Failed to save hours: ${updateError.message}` },
      hours,
    };
  }

  if (count === 0) {
    return {
      errors: {
        form: "Venue not found or you don't have permission to edit it.",
      },
      hours,
    };
  }

  // Success — redirect back to dashboard.
  redirect("/dashboard");
}
