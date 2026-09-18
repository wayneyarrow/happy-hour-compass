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
 * PHASE 1A ONLY ACTUALLY EMITS "activation_started" and "account_activated" —
 * see ACTIVATION_STARTED and ACCOUNT_ACTIVATED below, and the call sites in
 * src/lib/operatorActivation.ts / the four provisionOperatorForVenue() call
 * sites. Every other value here is a named placeholder for a later phase
 * (reminders, expiry, OTP) and MUST NOT be written by any code yet — adding a
 * type does not create an event; only an actual write does, and this phase
 * intentionally makes zero writes for any event type outside those two.
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
  "code_verified",
  "password_set",
  "account_activated",
  "activation_expired",
  "venue_released",
  "founder_manual_release",
  "cleanup_failure",
] as const;

export type ActivationEventType = (typeof ACTIVATION_EVENT_TYPES)[number];
