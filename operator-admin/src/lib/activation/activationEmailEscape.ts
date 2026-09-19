/**
 * Minimal HTML-escaping helper for the Phase 2A-3 activation reminder/expiry
 * email templates (activationReminderEmails.ts, activationExpiryNotifications.ts).
 * Scoped narrowly to this feature — legacy email templates in src/lib/email.ts
 * follow their own existing (unescaped) interpolation convention and are out
 * of scope for this fix.
 *
 * Escapes the five characters that matter for safe interpolation into an
 * HTML text node: & < > " '. Apply this to every database-controlled string
 * (operator name, venue name, email address, etc.) immediately before
 * interpolating it into an HTML template's markup.
 *
 * Do NOT apply this to a URL (a setup link or Control Panel URL) — those are
 * not HTML text, escaping them would corrupt the link, and they are never
 * user-authored display text in the first place. Do NOT apply this to a
 * plain-text (non-HTML) email body — the recipient should see literal
 * characters there, not HTML entities.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
