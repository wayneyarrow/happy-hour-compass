/**
 * Server-side flag for setup-contact / milestone email coordination
 * (setupContactPolicy.ts). Fail closed: only the literal string "true"
 * enables it.
 *
 * OFF (default): the milestone and reminder workers send exactly as before
 * — standard milestone template, no deferral, no skipped reminders. Contact
 * EVIDENCE is still recorded (setup emails, Copy-link pauses, milestone
 * sends to unactivated operators), so turning the flag on does not start
 * blind.
 *
 * ON: incomplete-setup milestone variant with a Finish-your-setup CTA, 48 h
 * spacing in both directions, and reminders skipped when spacing would cross
 * the setup deadline.
 */
export function isSetupContactCoordinationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SETUP_CONTACT_COORDINATION_ENABLED === "true";
}
