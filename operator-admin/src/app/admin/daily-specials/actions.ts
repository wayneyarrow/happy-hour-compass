"use server";

/**
 * Daily Specials server actions — save/delete.
 *
 * Security sequence follows saveEventAction/deleteEventAction
 * (src/app/admin/events/actions.ts) exactly:
 *   1. resolveOperatorContext() — WHO is asking.
 *   2. Authoritative target venue — impersonation's session venue always
 *      wins over any client-supplied venueId.
 *   3. Normal (non-impersonating) operators must own the target venue —
 *      checked against ctx.venues, never trusted from the payload alone.
 *   4. Venue-level plan via getVenuePlanCode(targetVenueId) — never the
 *      operator's own plan, never a sibling venue's (Phase 2B venue-level
 *      entitlement model).
 *   5. On edit, the CURRENT row is re-read from the database (is_seeded_special,
 *      schedule_type) — grandfathering is derived from THAT read, never
 *      from the incoming payload. currentSpecialId is null for an insert,
 *      so a brand-new special can never inherit a grandfathered exception.
 *   6/7. Content/schedule/time validated with the Phase 1 pure validators,
 *      then recurring entitlement enforced via authorizeDailySpecialSave()
 *      (src/lib/dailySpecialAuthorization.ts).
 *   8/9. creator/updater stamped, row written.
 *   10. Structured { savedId } | { error } result.
 *
 * Client/UI gating (the plan-gated radio, the grandfathered-row messaging)
 * is convenience only — this file is the authoritative enforcement point.
 */

import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";
import { getVenuePlanCode } from "@/lib/venueSubscriptions";
import {
  authorizeDailySpecialSave,
  shouldStampSeededOnCreate,
  type DailySpecialCurrentRow,
} from "@/lib/dailySpecialAuthorization";
import {
  validateDailySpecialContent,
  validateDailySpecialSchedule,
  validateDailySpecialTime,
} from "@/lib/dailySpecialSchedule";
import { isOfferType, isScheduleType, type DailySpecialDbRow } from "@/lib/dailySpecialTypes";

const REVALIDATE_PATH = "/admin/daily-specials";

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param specialId  Daily Special to delete.
 * @param venueId    The venue the caller is currently managing (mirrors
 *   deleteEventAction's venueId param). Authorization is based on the
 *   special belonging to this venue, not on who created it —
 *   created_by_operator_id is NULL for every platform-seeded special. In
 *   impersonation, the session's own venue always wins over this
 *   caller-supplied value.
 *
 * No plan/entitlement check — deletion is unrestricted by plan (matches
 * deleteEventAction exactly). A grandfathered recurring Special can always
 * be deleted by its rightful venue owner; doing so creates no reusable
 * recurring entitlement (see authorizeDailySpecialSave's doc comment — the
 * grandfathering check always re-derives from the CURRENT row, and once
 * deleted there is no row to derive `true` from for any future save).
 */
export async function deleteDailySpecialAction(specialId: string, venueId: string): Promise<void> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    throw new Error(ctx.operatorError ?? "Could not resolve operator.");
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    throw new Error("Venue not found or you don't have permission to manage it.");
  }

  const { error, count } = await ctx.supabase
    .from("daily_specials")
    .delete({ count: "exact" })
    .eq("id", specialId)
    .eq("venue_id", targetVenueId);

  if (error) {
    console.error("[deleteDailySpecialAction] Delete failed:", error);
    throw new Error("Failed to delete Daily Special.");
  }

  // A 0-row delete is not an error to Postgrest/Supabase — verify explicitly.
  if (!count) {
    console.error("[deleteDailySpecialAction] Delete matched zero rows:", { specialId, targetVenueId });
    throw new Error("This Daily Special could not be found for your venue. It may have already been deleted.");
  }

  revalidatePath(REVALIDATE_PATH);
}

// ─────────────────────────────────────────────────────────────────────────────
// Save (create or update)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client payload for saveDailySpecialAction. Deliberately has NO
 * is_seeded_special / source_url / last_verified_at fields — these are
 * HHC provenance fields, never operator-editable in Phase 2 (see the task
 * brief). is_seeded_special is computed server-side only, on insert, via
 * shouldStampSeededOnCreate(); it is never read from or written by any
 * update.
 */
export type DailySpecialSavePayload = {
  venueId: string;
  title: string;
  /** OfferType — validated server-side via isOfferType(). */
  offerType: string;
  shortSummary: string | null;
  description: string | null;
  conditions: string | null;
  /** ScheduleType — validated server-side via isScheduleType(). */
  scheduleType: string;
  oneTimeDate: string | null;
  daysOfWeek: number[] | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
  /** TimeMode. */
  timeMode: string;
  startTime: string | null;
  /** EndMode. */
  endMode: string;
  endTime: string | null;
  isPublished: boolean;
};

export type SaveDailySpecialResult = { savedId: string } | { error: string };

/**
 * Creates or updates a Daily Special row with full server-side enforcement.
 *
 * @param payload           Form data from the client.
 * @param currentSpecialId  Existing special id for updates; null/undefined for inserts.
 */
export async function saveDailySpecialAction(
  payload: DailySpecialSavePayload,
  currentSpecialId?: string | null
): Promise<SaveDailySpecialResult> {
  // ── 1. Resolve operator context ─────────────────────────────────────────
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve your operator account." };
  }

  // ── 2. Authoritative target venue ───────────────────────────────────────
  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? payload.venueId) : payload.venueId;

  // ── 3. Normal operators must own the target venue ──────────────────────
  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  // ── 4. Resolve the VENUE's plan ─────────────────────────────────────────
  const plan = await getVenuePlanCode(targetVenueId);

  // Support-mode exception (Case B only — founder impersonating an
  // unclaimed venue). Never true for Case A (claimed-venue impersonation)
  // or a normal operator login, both of which always have ctx.operator set.
  const isUnclaimedVenueSupportMode = ctx.isImpersonating && !ctx.operator;

  // ── 5. On edit, load the CURRENT row — never trust the payload ─────────
  let currentRow: DailySpecialCurrentRow | null = null;
  if (currentSpecialId) {
    const { data: existing } = await ctx.supabase
      .from("daily_specials")
      .select("is_seeded_special, schedule_type")
      .eq("id", currentSpecialId)
      .eq("venue_id", targetVenueId)
      .maybeSingle();

    if (existing) {
      currentRow = {
        isSeededSpecial: existing.is_seeded_special === true,
        scheduleType: existing.schedule_type as string,
      };
    }
    // existing === null here means "no row matched this id for this venue"
    // — handled below by the update's 0-row-affected check, not here, so
    // the error message stays consistent regardless of WHY the row didn't
    // match (never existed vs. belongs to another venue).
  }

  // ── 6. Validate incoming content/schedule/time ──────────────────────────
  if (!payload.title?.trim()) {
    return { error: "Please enter a title." };
  }
  if (!isOfferType(payload.offerType)) {
    return { error: "Please select a type (Food, Drink, or Food & Drink)." };
  }
  if (!isScheduleType(payload.scheduleType)) {
    return { error: "Please choose how often this special runs." };
  }

  const scheduleValidation = validateDailySpecialSchedule({
    scheduleType: payload.scheduleType,
    oneTimeDate: payload.scheduleType === "one_time" ? payload.oneTimeDate : null,
    daysOfWeek: payload.scheduleType === "weekly" ? payload.daysOfWeek : null,
    recurrenceStartDate: payload.scheduleType === "weekly" ? payload.recurrenceStartDate : null,
    recurrenceEndDate: payload.scheduleType === "weekly" ? payload.recurrenceEndDate : null,
  });
  if (!scheduleValidation.valid) {
    return { error: scheduleValidation.errors[0] };
  }

  const timeValidation = validateDailySpecialTime({
    timeMode: payload.timeMode,
    startTime: payload.timeMode === "timed" ? payload.startTime : null,
    endMode: payload.timeMode === "timed" ? payload.endMode : "unspecified",
    endTime: payload.timeMode === "timed" && payload.endMode === "time" ? payload.endTime : null,
  });
  if (!timeValidation.valid) {
    return { error: timeValidation.errors[0] };
  }

  const contentValidation = validateDailySpecialContent({
    shortSummary: payload.shortSummary,
    description: payload.description,
  });
  if (!contentValidation.valid) {
    return { error: contentValidation.errors[0] };
  }

  // ── 7. Enforce recurring entitlement server-side ────────────────────────
  const authorization = authorizeDailySpecialSave({
    plan,
    isUnclaimedVenueSupportMode,
    requestedScheduleType: payload.scheduleType,
    currentRow,
  });
  if (!authorization.authorized) {
    return { error: authorization.reason };
  }

  // ── 8. Build the row fields ──────────────────────────────────────────────
  const isOneTime = payload.scheduleType === "one_time";
  const isTimed = payload.timeMode === "timed";

  const fields = {
    title: payload.title.trim(),
    offer_type: payload.offerType,
    short_summary: payload.shortSummary?.trim() || null,
    description: payload.description?.trim() || null,
    conditions: payload.conditions?.trim() || null,
    schedule_type: payload.scheduleType,
    one_time_date: isOneTime ? payload.oneTimeDate : null,
    days_of_week: isOneTime ? null : payload.daysOfWeek,
    recurrence_start_date: isOneTime ? null : (payload.recurrenceStartDate || null),
    recurrence_end_date: isOneTime ? null : (payload.recurrenceEndDate || null),
    time_mode: payload.timeMode,
    start_time: isTimed ? (payload.startTime || null) : null,
    end_mode: isTimed ? payload.endMode : "unspecified",
    end_time: isTimed && payload.endMode === "time" ? payload.endTime : null,
    is_published: payload.isPublished,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  // ── 9. Save ───────────────────────────────────────────────────────────────
  if (currentSpecialId) {
    const { error: updateError, count } = await ctx.supabase
      .from("daily_specials")
      .update({ ...fields, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", currentSpecialId)
      .eq("venue_id", targetVenueId);

    if (updateError) {
      console.error("[saveDailySpecialAction] Update failed:", updateError);
      return { error: updateError.message || "Failed to save Daily Special. Please try again." };
    }

    if (!count) {
      console.error("[saveDailySpecialAction] Update matched zero rows:", { currentSpecialId, targetVenueId });
      return { error: "This Daily Special could not be found for your venue. It may have been deleted or moved." };
    }

    revalidatePath(REVALIDATE_PATH);
    return { savedId: currentSpecialId };
  }

  // Insert — is_seeded_special is computed here, server-side only, and is
  // never read from payload. See shouldStampSeededOnCreate()'s doc comment.
  const { data: inserted, error: insertError } = await ctx.supabase
    .from("daily_specials")
    .insert([{
      ...fields,
      venue_id: targetVenueId,
      ...(ctx.operator ? { created_by_operator_id: ctx.operator.id } : {}),
      is_seeded_special: shouldStampSeededOnCreate(isUnclaimedVenueSupportMode, payload.scheduleType),
    }])
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("[saveDailySpecialAction] Insert failed:", insertError);
    return { error: insertError?.message || "Failed to create Daily Special. Please try again." };
  }

  revalidatePath(REVALIDATE_PATH);
  return { savedId: inserted.id as string };
}

// ─────────────────────────────────────────────────────────────────────────────
// List refresh (impersonation fix)
//
// BUG THIS EXISTS TO FIX: DailySpecialsManager.tsx's client-side
// refreshList() previously queried `daily_specials` directly through the
// BROWSER Supabase client (src/lib/supabase/browser.ts). That client is
// always authenticated as whoever is actually logged into the browser —
// during founder impersonation, that is the FOUNDER's own real session,
// completely independent of the server-side-only imp_session_id httpOnly
// cookie (browser JS cannot read it). Daily Specials' SELECT RLS policy
// ("daily_specials: read for own venue", migration 091) is correctly
// venue-ownership-scoped, so a founder's own browser session — almost
// never the actual owner of whatever venue they're impersonating — got
// ZERO rows back from that query, even though the save/delete that
// triggered the refresh had already succeeded server-side (via
// resolveOperatorContext()'s admin client, which correctly bypasses RLS
// during impersonation). The row was really there; the list just silently
// went empty, which looked exactly like "nothing saved."
//
// Events' identical refreshList() pattern (EventsManager.tsx) never
// surfaced this because events' SELECT policy is permissive
// (USING (TRUE), unchanged since 001_initial_schema.sql) — ANY
// authenticated user can read ALL events, so it never mattered who was
// actually asking. That is Events' policy being looser, not Daily
// Specials' policy being wrong — RLS is not weakened here to "match"
// Events; instead, the read is moved to where the correct identity is
// already resolved.
//
// FIX: this server action re-fetches the list through
// resolveOperatorContext() — the same authorization sequence every other
// Daily Specials action already uses — so the read always reflects
// whoever (or whichever impersonated identity) is actually active,
// exactly like the initial page.tsx server-side fetch already does
// correctly. No RLS policy changes; the fix is entirely about which
// client performs the read.
// ─────────────────────────────────────────────────────────────────────────────

const DAILY_SPECIAL_LIST_COLUMNS =
  "id, venue_id, title, offer_type, short_summary, description, conditions, image_url, " +
  "schedule_type, one_time_date, days_of_week, recurrence_start_date, recurrence_end_date, " +
  "time_mode, start_time, end_mode, end_time, " +
  "is_published, is_seeded_special, source_url, last_verified_at, " +
  "created_by_operator_id, updated_by_operator_id, created_at, updated_at";

export async function getDailySpecialsForActiveVenueAction(
  venueId: string
): Promise<{ specials: DailySpecialDbRow[] } | { error: string }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  const { data, error } = await ctx.supabase
    .from("daily_specials")
    .select(DAILY_SPECIAL_LIST_COLUMNS)
    .eq("venue_id", targetVenueId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[getDailySpecialsForActiveVenueAction] Query failed:", error);
    return { error: "Failed to load Daily Specials. Please try again." };
  }

  return { specials: (data ?? []) as unknown as DailySpecialDbRow[] };
}
