/**
 * Structured Internal Note event vocabulary for the shared operator-
 * activation lifecycle (Claims + Add Your Venue submissions).
 *
 * This is the full planned vocabulary for the activation lifecycle across
 * ALL phases, not just what Phase 1A implements — see migration 098's header
 * for why this lives as a TypeScript union rather than a DB CHECK constraint
 * (a future event type never needs a migration). Enforcing "which events are
 * valid" at this layer, in one place, is what lets
 * src/lib/activation/activationNotes.ts's writer function take a typed
 * `eventType` parameter instead of an unchecked string.
 *
 * ACTUALLY EMITTED TODAY: "activation_started" and "account_activated"
 * (Phase 1A, from src/lib/operatorActivation.ts / the four
 * provisionOperatorForVenue() call sites), "manual_resend" and
 * "deadline_extended" (Phase 1B, founder-triggered — see
 * resendClaimSetupEmailImpl.ts / extendActivationDeadlineImpl.ts), and
 * "legacy_activation_resumed" (Phase 1C, founder-triggered — see
 * legacyActivationResumeImpl.ts). Every other value here remains a named
 * placeholder for a later phase (reminders, expiry, OTP) and MUST NOT be
 * written by any code yet — adding a type does not create an event; only an
 * actual write does.
 */

export const ACTIVATION_EVENT_TYPES = [
  "auto_decision",
  "founder_decision",
  "activation_started",
  "setup_code_sent",
  "setup_delivery_failed",
  "reminder_scheduled",
  "reminder_sent",
  "reminder_delivery_failed",
  "manual_resend",
  "deadline_extended",
  "legacy_activation_resumed",
  "code_verified",
  "password_set",
  "account_activated",
  "activation_expired",
  "venue_released",
  "founder_manual_release",
  "cleanup_failure",
] as const;

export type ActivationEventType = (typeof ACTIVATION_EVENT_TYPES)[number];

/**
 * Friendly, founder-facing labels for structured Internal Note event types
 * (Phase 1B). Only a subset of ACTIVATION_EVENT_TYPES is ever actually
 * written yet (activation_started, account_activated, manual_resend,
 * deadline_extended — see each writer's call sites) but every value here has
 * a label so the UI never has to special-case an unlabeled type, and a
 * future event type added to the vocabulary above without a matching label
 * still renders safely via getActivationEventLabel()'s fallback rather than
 * throwing or showing "undefined".
 */
export const ACTIVATION_EVENT_LABELS: Record<ActivationEventType, string> = {
  auto_decision: "Automatic decision",
  founder_decision: "Founder decision",
  activation_started: "Activation started",
  setup_code_sent: "Setup code sent",
  setup_delivery_failed: "Setup delivery failed",
  reminder_scheduled: "Reminder scheduled",
  reminder_sent: "Reminder sent",
  reminder_delivery_failed: "Reminder delivery failed",
  manual_resend: "Setup email resent",
  deadline_extended: "Activation deadline extended",
  legacy_activation_resumed: "Activation tracking resumed (legacy)",
  code_verified: "Code verified",
  password_set: "Password set",
  account_activated: "Account activated",
  activation_expired: "Activation expired",
  venue_released: "Venue released",
  founder_manual_release: "Venue released by founder",
  cleanup_failure: "Cleanup failure",
};

/**
 * Friendly label for a note's event_type — null/unrecognized (legacy notes,
 * or a value predating this label map) falls back to a safe, generic label
 * rather than showing the raw machine-readable string or crashing.
 */
export function getActivationEventLabel(eventType: string | null): string | null {
  if (!eventType) return null;
  return (ACTIVATION_EVENT_LABELS as Record<string, string>)[eventType] ?? "System event";
}
