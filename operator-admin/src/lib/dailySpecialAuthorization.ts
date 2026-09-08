/**
 * Daily Specials save-authorization — the pure decision logic behind
 * saveDailySpecialAction (src/app/admin/daily-specials/actions.ts).
 *
 * Extracted as a pure, no-I/O function for the same reason
 * resolvePlanCodeFromVenueSubscription()/highestPlan() were extracted from
 * src/lib/venueSubscriptions.ts, and computeActiveVenueId() from
 * src/lib/impersonation.ts: this is the one piece of the save flow with no
 * Supabase call of its own, so it's the piece that gets real, executable
 * tests (tests/unit/dailySpecials/authorization.test.ts) rather than only
 * a static source-text check on the server action itself.
 *
 * saveEventAction has no equivalent extracted function — its entitlement
 * check is inlined. Daily Specials does it differently on purpose: this
 * task requires test coverage for a long, specific list of create/edit
 * scenarios (including the "weekly -> one_time -> weekly again" sequential
 * case), and the only honest way to get real coverage for server-action
 * logic with no DI seam in this codebase's test setup is to make the
 * decision itself a pure function and test that directly.
 *
 * CRITICAL SAFETY CONTRACT (mirrors saveEventAction exactly — see
 * src/lib/plans.ts's canManageGrandfatheredRecurringDailySpecial doc
 * comment): `currentRow` must always be derived from a FRESH DATABASE READ
 * performed by the caller immediately before calling this function — never
 * from the incoming client payload. This function has no way to enforce
 * that itself (it only sees whatever its caller passes); the server action
 * is responsible for that read discipline, and is covered separately by
 * tests/unit/dailySpecials/serverActionsRegression.test.ts, which pins
 * (via static source inspection) that the real action never reads
 * `payload.isSeededSpecial` and always re-queries the row.
 */

import {
  canCreateRecurringDailySpecialInSupportMode,
  canManageGrandfatheredRecurringDailySpecial,
  canUseRecurringDailySpecials,
  type OperatorPlan,
} from "./plans";
import type { ScheduleType } from "./dailySpecialTypes";

/** Minimal shape of the CURRENT database row needed to evaluate grandfathering. Null for a brand-new insert (no current row exists). */
export type DailySpecialCurrentRow = {
  isSeededSpecial: boolean;
  scheduleType: ScheduleType | string;
};

export type DailySpecialSaveAuthorizationInput = {
  /** The TARGET VENUE's plan (getVenuePlanCode(targetVenueId)) — never the operator's own plan, never a sibling venue's. */
  plan: OperatorPlan;
  /** True only for founder impersonation of an UNCLAIMED venue (Case B) — see saveEventAction's identical flag. */
  isUnclaimedVenueSupportMode: boolean;
  /** The schedule_type the incoming save is requesting. */
  requestedScheduleType: ScheduleType | string;
  /** The row's CURRENT database state (edit only). Null for a new insert. */
  currentRow: DailySpecialCurrentRow | null;
};

export type DailySpecialSaveAuthorizationResult =
  | { authorized: true }
  | { authorized: false; reason: string };

export const RECURRING_NOT_AUTHORIZED_MESSAGE =
  "Recurring Daily Specials are available on Pro and Premium plans. " +
  'Select "One time" or upgrade your plan to schedule a recurring Daily Special.';

/**
 * Decides whether a save (insert OR update) may proceed, given the target
 * venue's plan, support-mode status, the requested schedule_type, and the
 * row's CURRENT database state.
 *
 * One-time specials are always authorized on every plan — this function
 * only ever blocks a save that REQUESTS schedule_type = 'weekly'.
 */
export function authorizeDailySpecialSave(
  input: DailySpecialSaveAuthorizationInput
): DailySpecialSaveAuthorizationResult {
  if (input.requestedScheduleType !== "weekly") {
    return { authorized: true };
  }

  if (canUseRecurringDailySpecials(input.plan)) {
    return { authorized: true };
  }

  if (canCreateRecurringDailySpecialInSupportMode(input.isUnclaimedVenueSupportMode)) {
    return { authorized: true };
  }

  // Grandfathered exception — derived strictly from the CURRENT row passed
  // in by the caller (never the incoming payload). A brand-new insert has
  // currentRow = null, so isSeededAndCurrentlyRecurring is always false for
  // any new special — there is no current row to derive `true` from.
  const isSeededAndCurrentlyRecurring =
    !!input.currentRow?.isSeededSpecial && input.currentRow?.scheduleType === "weekly";

  if (canManageGrandfatheredRecurringDailySpecial(input.plan, isSeededAndCurrentlyRecurring)) {
    return { authorized: true };
  }

  return { authorized: false, reason: RECURRING_NOT_AUTHORIZED_MESSAGE };
}

/**
 * Whether a NEW row being inserted should be auto-stamped
 * is_seeded_special = true. Mirrors saveEventAction's insert-time
 * `is_seeded_event: isUnclaimedVenueSupportMode && isRecurring(payload.recurrence)`
 * exactly — only meaningful for a fresh INSERT; an UPDATE must never touch
 * is_seeded_special via this or any other path (the server action's update
 * `fields` object simply never includes the column).
 */
export function shouldStampSeededOnCreate(
  isUnclaimedVenueSupportMode: boolean,
  requestedScheduleType: ScheduleType | string
): boolean {
  return isUnclaimedVenueSupportMode && requestedScheduleType === "weekly";
}
