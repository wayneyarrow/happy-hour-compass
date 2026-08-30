"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { resolveOperatorContext } from "@/lib/impersonation";
import {
  canCreateRecurringEventInSupportMode,
  canManageGrandfatheredRecurringEvent,
  canUseRecurringEvents,
} from "@/lib/plans";
import { getVenuePlanCode } from "@/lib/venueSubscriptions";
import { isRecurring } from "./recurrenceUtils";
import {
  MAX_SLUG_GENERATION_ATTEMPTS,
  MissingVenueSlugError,
  generateEventSlug,
  isUniqueSlugViolation,
} from "@/lib/eventSlug";

// ─────────────────────────────────────────────────────────────────────────────
// Delete event
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param eventId  Event to delete.
 * @param venueId  The venue the caller is currently managing (EventsManager's
 *   own venueId prop). Authorization is based on the event belonging to this
 *   venue, not on who created it — created_by_operator_id is NULL for every
 *   platform-seeded event, so scoping by it (the previous behaviour) silently
 *   matched zero rows for any seeded event on a claimed venue. In
 *   impersonation, the session's own venue always wins over this
 *   caller-supplied value — matches saveEventAction's targetVenueId.
 */
export async function deleteEventAction(eventId: string, venueId: string): Promise<void> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    throw new Error(ctx.operatorError ?? "Could not resolve operator.");
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  // Never trust a client-submitted venueId on its own — must be one of the
  // venues resolveOperatorContext() actually resolved for this operator.
  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    throw new Error("Venue not found or you don't have permission to manage it.");
  }

  const { error, count } = await ctx.supabase
    .from("events")
    .delete({ count: "exact" })
    .eq("id", eventId)
    .eq("venue_id", targetVenueId);

  if (error) {
    console.error("[deleteEventAction] Delete failed:", error);
    throw new Error("Failed to delete event.");
  }

  // A 0-row delete is not an error to Postgrest/Supabase — verify explicitly
  // rather than let the caller believe this succeeded.
  if (!count) {
    console.error("[deleteEventAction] Delete matched zero rows:", { eventId, targetVenueId });
    throw new Error("This event could not be found for your venue. It may have already been deleted.");
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
 * Grandfathered exception: a platform-seeded event that is currently recurring
 * (is_seeded_event = true, recurrence != "none") may still be fully edited —
 * including recurrence changes and publish/unpublish — by a Free-plan operator.
 * See canManageGrandfatheredRecurringEvent() in src/lib/plans.ts. This is
 * checked against the row's state in the database *before* this update, so it
 * never extends to creating a new recurring event or converting a one-time
 * event (seeded or not) into a recurring one.
 *
 * Update/delete authorization is based on the event belonging to the
 * currently managed venue (targetVenueId below) — never on who created the
 * row. created_by_operator_id is NULL for every platform-seeded event, so it
 * was never a reliable "does this operator own this event" signal; scoping
 * by it silently matched zero rows for any seeded event on a claimed venue
 * (see deleteEventAction for the matching fix). created_by_operator_id /
 * updated_by_operator_id are still stamped on writes purely for attribution
 * (left unset when there's no real operator — impersonation of an unassigned
 * venue), never used for authorization. Mirrors the venue-scoping pattern in
 * venueActions.ts / imageActions.ts.
 *
 * Support-mode recurring exception: Case B also bypasses the recurring-event
 * plan check entirely (see canCreateRecurringEventInSupportMode() in
 * src/lib/plans.ts) — the founder can create and manage recurring events for
 * an unclaimed venue even though the implicit plan (no operator → "free")
 * would otherwise forbid it. Every such recurring insert is automatically
 * stamped is_seeded_event = true, so once the venue is claimed the new
 * operator inherits it as a grandfathered seeded recurring event through the
 * existing canManageGrandfatheredRecurringEvent() path — no separate
 * entitlement system. Claimed-venue impersonation (Case A) and normal
 * operator logins always have a real ctx.operator and get no bypass; they
 * follow canUseRecurringEvents(plan) / canManageGrandfatheredRecurringEvent()
 * exactly as before.
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

  // In impersonation, enforce the session's venue rather than the
  // caller-supplied payload.venueId — matches uploadVenueImageAction() etc.
  const targetVenueId = ctx.isImpersonating
    ? (ctx.sessionVenueId ?? payload.venueId)
    : payload.venueId;

  // Never trust a client-submitted venueId on its own — must be one of the
  // venues resolveOperatorContext() actually resolved for this operator.
  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  // Phase 2B: entitlement resolves from the TARGET venue's own plan, not
  // the operator's — preserves every existing grandfathering/support-mode
  // exception exactly (isUnclaimedVenueSupportMode below is unrelated to
  // this change).
  const plan = await getVenuePlanCode(targetVenueId);

  // Support-mode exception (Case B only — founder impersonating an unclaimed
  // venue). Never true for Case A (claimed-venue impersonation) or a normal
  // operator login, both of which always have ctx.operator set.
  const isUnclaimedVenueSupportMode = ctx.isImpersonating && !ctx.operator;

  // ── Server-side recurring events entitlement ──────────────────────────────
  // isRecurring() covers ALL recurrence values other than "none", so future
  // options automatically require a paid plan without any additional code.
  if (
    isRecurring(payload.recurrence) &&
    !canUseRecurringEvents(plan) &&
    !canCreateRecurringEventInSupportMode(isUnclaimedVenueSupportMode)
  ) {
    // Grandfathered exception: check the row's *current* state (not the
    // incoming payload) for a platform-seeded event that is still recurring.
    // currentEventId is null for inserts, so new recurring events are never
    // eligible — only an existing seeded-and-recurring row can qualify.
    let isSeededAndCurrentlyRecurring = false;

    if (currentEventId) {
      const { data: existing } = await ctx.supabase
        .from("events")
        .select("recurrence, is_seeded_event")
        .eq("id", currentEventId)
        .eq("venue_id", targetVenueId)
        .maybeSingle();

      isSeededAndCurrentlyRecurring =
        !!existing?.is_seeded_event && isRecurring(existing.recurrence ?? "none");
    }

    if (!canManageGrandfatheredRecurringEvent(plan, isSeededAndCurrentlyRecurring)) {
      return {
        error:
          "Recurring events are available on Pro and Premium plans. " +
          "Select \"One-time (no repeat)\" or upgrade your plan to schedule recurring events.",
      };
    }
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
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  if (currentEventId) {
    const { error: updateError, count } = await ctx.supabase
      .from("events")
      .update({ ...fields, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", currentEventId)
      .eq("venue_id", targetVenueId);

    if (updateError) {
      console.error("[saveEventAction] Update failed:", updateError);
      return { error: updateError.message || "Failed to save event. Please try again." };
    }

    // A 0-row update is not an error to Postgrest/Supabase — verify
    // explicitly rather than report success when nothing actually changed.
    if (!count) {
      console.error("[saveEventAction] Update matched zero rows:", { currentEventId, targetVenueId });
      return { error: "This event could not be found for your venue. It may have been deleted or moved." };
    }

    revalidatePath("/admin/events");
    return { savedId: currentEventId };
  }

  // ── Insert new event ──────────────────────────────────────────────────────
  // Slug is venue-qualified and generated once, here, at creation — never
  // regenerated on later edits (see the update branch above, which never
  // touches `slug`). See src/lib/eventSlug.ts for the full algorithm.
  let slug: string;
  try {
    slug = await generateEventSlug(ctx.supabase, {
      venueId: targetVenueId,
      title: payload.title ?? "",
    });
  } catch (err) {
    if (err instanceof MissingVenueSlugError) {
      console.error("[saveEventAction] Slug generation failed:", err);
      return {
        error: "This venue is missing a slug and can't be used to create an event yet. Please contact support.",
      };
    }
    console.error("[saveEventAction] Slug generation failed:", err);
    return { error: "Failed to create event. Please try again." };
  }

  let inserted: { id: string } | null = null;
  let lastError: PostgrestError | null = null;

  for (let attempt = 0; attempt < MAX_SLUG_GENERATION_ATTEMPTS; attempt++) {
    const { data, error } = await ctx.supabase
      .from("events")
      .insert([{
        ...fields,
        slug,
        venue_id:                targetVenueId,
        ...(ctx.operator ? { created_by_operator_id: ctx.operator.id } : {}),
        // Recurring events created via unclaimed-venue support mode are
        // platform-provided content by definition — auto-flag them so a
        // future claiming operator inherits them as grandfathered seeded
        // recurring events (see canManageGrandfatheredRecurringEvent()).
        // One-time events, and anything created outside support mode, keep
        // the existing false default.
        is_seeded_event:         isUnclaimedVenueSupportMode && isRecurring(payload.recurrence),
      }])
      .select("id")
      .single();

    if (!error) {
      inserted = data as { id: string };
      break;
    }

    lastError = error;

    // A real race lost to the DB's UNIQUE constraint (the final integrity
    // safeguard) — regenerate against now-current state and retry, rather
    // than surface the raw constraint violation to the operator.
    if (isUniqueSlugViolation(error) && attempt < MAX_SLUG_GENERATION_ATTEMPTS - 1) {
      try {
        slug = await generateEventSlug(ctx.supabase, {
          venueId: targetVenueId,
          title: payload.title ?? "",
        });
      } catch (err) {
        console.error("[saveEventAction] Slug regeneration after collision failed:", err);
        break;
      }
      continue;
    }

    break;
  }

  if (!inserted) {
    console.error("[saveEventAction] Insert failed:", lastError);
    return { error: "Failed to create event. Please try again." };
  }

  revalidatePath("/admin/events");
  return { savedId: inserted.id };
}
