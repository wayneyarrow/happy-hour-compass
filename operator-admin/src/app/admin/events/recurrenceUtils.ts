/**
 * Shared recurrence utilities for event scheduling.
 *
 * Importable from both client components ("use client") and server actions
 * ("use server") — no framework-specific directives.
 *
 * Business rule:
 *   Anything that is NOT "none" is a recurring event and requires a paid plan.
 *   isRecurring() is the single enforcement point for this rule.
 *   Future recurrence options (e.g. "biweekly", "quarterly") automatically
 *   inherit the paid-plan requirement without any code changes.
 */

export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export const KNOWN_RECURRENCES = new Set<Recurrence>([
  "none",
  "daily",
  "weekly",
  "monthly",
]);

/**
 * Returns true when the recurrence value represents a repeating schedule.
 * One-time events ("none") are always free; everything else requires a paid plan.
 */
export function isRecurring(recurrence: string): boolean {
  return recurrence !== "none";
}

/** Safely coerces an unknown DB value to a valid Recurrence. Defaults to "none". */
export function toRecurrence(val: string | null | undefined): Recurrence {
  return val && KNOWN_RECURRENCES.has(val as Recurrence)
    ? (val as Recurrence)
    : "none";
}
