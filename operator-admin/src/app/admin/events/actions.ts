"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";
import { canUseRecurringEvents, parseOperatorPlan } from "@/lib/plans";
import { isRecurring } from "./recurrenceUtils";
import { slugify } from "@/lib/slugify";

// ─────────────────────────────────────────────────────────────────────────────
// Delete event
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteEventAction(eventId: string): Promise<void> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    throw new Error(ctx.operatorError ?? "Could not resolve operator.");
  }

  // Event management requires a known operator (Case B orphan venues have no operator).
  if (!ctx.operator) {
    throw new Error("Event management is not available in support mode for unassigned venues.");
  }

  const { error } = await ctx.supabase
    .from("events")
    .delete()
    .eq("id", eventId)
    .eq("created_by_operator_id", ctx.operator.id);

  if (error) {
    console.error("[deleteEventAction] Delete failed:", error);
    throw new Error("Failed to delete event.");
  }

  revalidatePath("/admin/events");
}

// ─────────────────────────────────────────────────────────────────────────────
// Save event (create or update)
// ─────────────────────────────────────────────────────────────────────────────

export type EventSavePayload = {
  venueId: string;
  title: string | null;
  eventType: string | null;
  description: string | null;
  firstDate: string;
  startTime: string;
  endTime: string | null;
  recurrence: string;
  isPublished: boolean;
  ticketingEnabled: boolean;
  ticketUrl: string | null;
  soldOut: boolean;
  // Premium landing page fields (migration 050)
  priceDisplay: string | null;
  ageRestriction: string | null;
  reservationRecommendation: string | null;
  parkingNotes: string | null;
  accessibilityNotes: string | null;
  teaser: string | null;
};

export type SaveEventResult = { savedId: string } | { error: string };

/** Parse "YYYY-MM-DD" as a local date to avoid UTC midnight shifting the day. */
function parseDateLocal(dateStr: string): Date | null {
  if (!dateStr) return null;
  const [y, mo, d] = dateStr.split("-").map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d);
}

function deriveEventFrequency(recurrence: string, firstDate: string): string | null {
  const d = parseDateLocal(firstDate);
  switch (recurrence) {
    case "weekly": {
      const day = d
        ? new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d)
        : null;
      return day ? `Every ${day}` : "Weekly";
    }
    case "daily":
      return "Every day";
    case "monthly": {
      if (!d) return "Monthly";
      const n = d.getDate();
      const suffix =
        n === 1 || n === 21 || n === 31 ? "st" :
        n === 2 || n === 22 ? "nd" :
        n === 3 || n === 23 ? "rd" : "th";
      return `Every month on the ${n}${suffix}`;
    }
    default:
      if (!d) return null;
      return new Intl.DateTimeFormat("en-US", {
        month: "short", day: "numeric", year: "numeric",
      }).format(d);
  }
}

/**
 * Creates or updates an event row with server-side plan enforcement.
 *
 * Plan rule: recurring events (any recurrence != "none") require Pro or higher.
 * Free operators can save one-time events only.
 *
 * Existing recurring events on a downgraded account are preserved — the operator
 * cannot create new recurring events or convert one-time events to recurring, but
 * their existing schedules continue running unaffected.
 *
 * @param payload  Event data from the client form.
 * @param currentEventId  Existing event id for updates; null/undefined for inserts.
 */
export async function saveEventAction(
  payload: EventSavePayload,
  currentEventId?: string | null
): Promise<SaveEventResult> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve your operator account." };
  }

  if (!ctx.operator) {
    return { error: "Event management is not available in support mode for unassigned venues." };
  }

  const plan = parseOperatorPlan(ctx.operator.plan);

  // ── Server-side recurring events entitlement ──────────────────────────────
  // isRecurring() covers ALL recurrence values other than "none", so future
  // options automatically require a paid plan without any additional code.
  if (isRecurring(payload.recurrence) && !canUseRecurringEvents(plan)) {
    return {
      error:
        "Recurring events are available on Pro and Premium plans. " +
        "Select \"One-time (no repeat)\" or upgrade your plan to schedule recurring events.",
    };
  }

  const event_time = payload.endTime
    ? `${payload.startTime} – ${payload.endTime}`
    : payload.startTime;

  const event_frequency = deriveEventFrequency(payload.recurrence, payload.firstDate);

  const fields = {
    title:                       payload.title,
    event_type:                  payload.eventType || "other",
    description:                 payload.description,
    first_date:                  payload.firstDate || null,
    start_time:                  payload.startTime || null,
    end_time:                    payload.endTime   || null,
    recurrence:                  payload.recurrence,
    event_time,
    event_frequency,
    is_published:                payload.isPublished,
    ticketing_enabled:           payload.ticketingEnabled,
    ticket_url:                  payload.ticketingEnabled ? (payload.ticketUrl || null) : null,
    sold_out:                    payload.soldOut,
    price_display:               payload.priceDisplay || null,
    age_restriction:             payload.ageRestriction || null,
    reservation_recommendation:  payload.reservationRecommendation || null,
    parking_notes:               payload.parkingNotes || null,
    accessibility_notes:         payload.accessibilityNotes || null,
    teaser:                      payload.teaser || null,
    updated_by_operator_id:      ctx.operator.id,
  };

  if (currentEventId) {
    const { error: updateError } = await ctx.supabase
      .from("events")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", currentEventId)
      .eq("created_by_operator_id", ctx.operator.id);

    if (updateError) {
      console.error("[saveEventAction] Update failed:", updateError);
      return { error: updateError.message || "Failed to save event. Please try again." };
    }

    revalidatePath("/admin/events");
    return { savedId: currentEventId };
  }

  // ── Insert new event ──────────────────────────────────────────────────────
  const slug = (payload.title ? slugify(payload.title) : "") || randomUUID();

  const { data: inserted, error: insertError } = await ctx.supabase
    .from("events")
    .insert([{
      ...fields,
      slug,
      venue_id:                payload.venueId,
      created_by_operator_id:  ctx.operator.id,
      is_seeded_event:         false,
    }])
    .select("id")
    .single();

  if (insertError) {
    console.error("[saveEventAction] Insert failed:", insertError);
    return { error: insertError.message || "Failed to create event. Please try again." };
  }

  revalidatePath("/admin/events");
  return { savedId: (inserted as { id: string }).id };
}
