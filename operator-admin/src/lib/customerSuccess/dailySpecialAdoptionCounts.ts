/**
 * Daily Specials adoption counts — the ONE set of counting rules shared by
 * the Action Center "Specials Adoption" card/report and the Control Panel
 * venue Feature Adoption card. Pure, no I/O.
 *
 * DEFINITIONS (how each Daily Special row is classified):
 *
 *   Operator-created — decided by how the row was CREATED, never by later
 *     edits. All of:
 *       - is_seeded_special = false (written only at INSERT; the edit path
 *         never touches it, so a seeded row stays seeded forever), AND
 *       - created_by_operator_id IS NOT NULL (unclaimed-venue support-mode
 *         creations have no operator), AND
 *       - is_genuine_operator_engaged = true, AND
 *       - created_at is NOT inside any operator_impersonation_sessions
 *         window for the same venue (HHC staff using "Open as Operator"
 *         stamp the real operator as creator — this is the creation-time
 *         evidence that separates them, the same check migration 096's
 *         backfill used).
 *     Why the last check is needed: is_genuine_operator_engaged is
 *     monotonic and is ALSO set when an operator merely EDITS a row, so on
 *     its own it would let an edit turn a platform-created row into
 *     "operator-created". The impersonation check plus the creator check
 *     make origin depend only on the creation event.
 *
 *   Platform-created — every other row: platform-seeded rows
 *     (is_seeded_special = true) and non-seeded rows HHC staff created
 *     (support mode or "Open as Operator") — even if the operator later
 *     edits them. `seeded` is broken out
 *     as its own sub-count.
 *
 *   Total — every row that currently exists, published OR draft. Each
 *     separately created one-time Special is its own row and counts
 *     individually (e.g. The Placery's weekly "Trivia, Tacos & Tequila"
 *     created as separate one-time dates = one entry per date). A weekly
 *     Special is ONE row regardless of how many dates it generates —
 *     occurrences are never materialized, so they can never be
 *     double-counted. Hard-deleted rows no longer exist and are not
 *     counted (there is no soft-delete or cancelled status on
 *     daily_specials).
 *
 *   Current or upcoming — published AND hasCurrentOrUpcomingOccurrence()
 *     against the venue's market-local today: a one-time date that is today
 *     or later, or a weekly Special with at least one remaining occurrence
 *     from today inside its validity window. Exactly the rule that decides
 *     whether consumers can still see the Special.
 *
 * Adoption is measured in VENUES: a venue has adopted Daily Specials (for
 * the Action Center count) when operatorTotal >= 1.
 */

import { coerceDailySpecialSchedule } from "@/lib/dailySpecialTypes";
import { hasCurrentOrUpcomingOccurrence } from "@/lib/dailySpecialSchedule";

export type DailySpecialCountRow = {
  created_at: string;
  created_by_operator_id: string | null;
  schedule_type: string;
  one_time_date: string | null;
  days_of_week: number[] | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  is_published: boolean;
  is_seeded_special: boolean;
  is_genuine_operator_engaged: boolean;
};

/** Columns to select for DailySpecialCountRow (plus venue_id for batched reads). */
export const DAILY_SPECIAL_COUNT_COLUMNS =
  "venue_id, created_at, created_by_operator_id, schedule_type, one_time_date, days_of_week, recurrence_start_date, recurrence_end_date, " +
  "is_published, is_seeded_special, is_genuine_operator_engaged";

export type DailySpecialAdoptionCounts = {
  /** Operator-created rows, published or draft. */
  operatorTotal: number;
  /** Operator-created rows that are published and current or upcoming. */
  operatorCurrentOrUpcoming: number;
  /** Operator-created rows still in draft (subset of operatorTotal). */
  operatorDrafts: number;
  /** All platform-created rows (seeded + HHC-staff-created), published or draft. */
  platformTotal: number;
  /** Subset of platformTotal with is_seeded_special = true. */
  seeded: number;
};

/** A staff impersonation window for one venue (operator_impersonation_sessions). */
export type ImpersonationWindow = { startedAt: string; endedAt: string };

/** Columns to select from operator_impersonation_sessions for toImpersonationWindow(). */
export const IMPERSONATION_WINDOW_COLUMNS = "venue_id, started_at, ended_at, expires_at";

/** Same window 096 used: started_at .. COALESCE(ended_at, expires_at). */
export function toImpersonationWindow(row: {
  started_at: string;
  ended_at: string | null;
  expires_at: string | null;
}): ImpersonationWindow | null {
  const end = row.ended_at ?? row.expires_at;
  return end ? { startedAt: row.started_at, endedAt: end } : null;
}

function createdDuringImpersonation(createdAt: string, windows: ImpersonationWindow[]): boolean {
  const t = new Date(createdAt).getTime();
  return windows.some((w) => new Date(w.startedAt).getTime() <= t && t <= new Date(w.endedAt).getTime());
}

export function isOperatorCreatedDailySpecial(
  row: Pick<DailySpecialCountRow, "is_seeded_special" | "is_genuine_operator_engaged" | "created_by_operator_id" | "created_at">,
  venueImpersonationWindows: ImpersonationWindow[]
): boolean {
  if (row.is_seeded_special) return false;
  if (!row.created_by_operator_id) return false;
  if (!row.is_genuine_operator_engaged) return false;
  return !createdDuringImpersonation(row.created_at, venueImpersonationWindows);
}

export function isDailySpecialCurrentOrUpcoming(row: DailySpecialCountRow, todayIsoDate: string): boolean {
  if (!row.is_published) return false;
  const schedule = coerceDailySpecialSchedule(row);
  if (!schedule) return false;
  return hasCurrentOrUpcomingOccurrence(schedule, todayIsoDate);
}

export function emptyDailySpecialAdoptionCounts(): DailySpecialAdoptionCounts {
  return { operatorTotal: 0, operatorCurrentOrUpcoming: 0, operatorDrafts: 0, platformTotal: 0, seeded: 0 };
}

/** `rows` and `venueImpersonationWindows` must belong to the same single venue. */
export function countDailySpecialsForAdoption(
  rows: DailySpecialCountRow[],
  todayIsoDate: string,
  venueImpersonationWindows: ImpersonationWindow[]
): DailySpecialAdoptionCounts {
  const counts = emptyDailySpecialAdoptionCounts();
  for (const row of rows) {
    if (isOperatorCreatedDailySpecial(row, venueImpersonationWindows)) {
      counts.operatorTotal++;
      if (!row.is_published) counts.operatorDrafts++;
      if (isDailySpecialCurrentOrUpcoming(row, todayIsoDate)) counts.operatorCurrentOrUpcoming++;
    } else {
      counts.platformTotal++;
      if (row.is_seeded_special) counts.seeded++;
    }
  }
  return counts;
}
