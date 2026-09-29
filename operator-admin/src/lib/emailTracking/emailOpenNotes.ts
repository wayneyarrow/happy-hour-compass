import { buildEmailOpenedNoteText, type EmailSendContext } from "./emailTrackingPolicy";
import type { EmailMessageRow } from "./emailTrackingStore";

/**
 * Read-time projection of email_messages first opens into the Founder
 * Control Panel venue Internal Notes timeline — same pattern as the Customer
 * Success milestone projection (customerSuccessMilestoneNotes.ts): computed
 * fresh on each page load, never copied into venue_notes, so there is one
 * source of truth and nothing to deduplicate. One entry per email that has
 * been opened at least once; only rows with a venue_id reach this (emails
 * without a venue never create a venue note).
 */

export const EMAIL_OPEN_ACTIVITY_AUTHOR_LABEL = "Happy Hour Compass";

export type EmailOpenNote = { id: string; note: string; created_at: string };

export function formatEmailOpenNote(row: EmailMessageRow): EmailOpenNote | null {
  if (!row.venue_id || !row.first_opened_at) return null;
  return {
    id: `email-open-${row.id}`,
    note: buildEmailOpenedNoteText({
      emailType: row.email_type,
      sendContext: (row.send_context as EmailSendContext | null) ?? null,
      recipientEmail: row.recipient_email,
      sentAt: row.sent_at,
    }),
    created_at: row.first_opened_at,
  };
}
