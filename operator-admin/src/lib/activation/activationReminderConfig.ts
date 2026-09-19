/**
 * Server-side kill switch for the operator-activation reminder/expiry
 * worker (Phase 2A-3), mirroring isCustomerSuccessEmailDeliveryEnabled()
 * (src/lib/customerSuccess/customerSuccessConfig.ts) exactly.
 *
 * Default (env var absent, empty, or anything other than the EXACT
 * lowercase string "true" — including "TRUE", "1", "false"): DISABLED. No
 * Supabase read, no Supabase write, and no external call (email/Slack) is
 * ever made while disabled. This is what keeps this entire feature
 * behaviorally inert in every environment — including Production — until
 * this env var is explicitly set, checked as the literal first executable
 * decision in processActivationReminders() (the LIVE entry point — the only
 * one the cron route ever calls).
 *
 * planActivationReminders() (the read-only CLI/test planning entry point in
 * the same file) deliberately never calls this function at all: read-only
 * planning must remain usable while this switch stays unset in every
 * environment, and its safety comes from its own internal `if (!dryRun)`
 * mutation/send guards, not from this switch. This is intentional, not a
 * gap — see that function's header comment.
 *
 * Server-only — there is no client-side equivalent, and this must never be
 * imported into a Client Component. Never logs or otherwise exposes the
 * env var's value.
 */
export function isOperatorActivationReminderProcessingEnabled(): boolean {
  return process.env.OPERATOR_ACTIVATION_REMINDERS_ENABLED === "true";
}
