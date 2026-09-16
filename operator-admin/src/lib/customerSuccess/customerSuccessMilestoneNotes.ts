/**
 * Formats a single customer_success_events row (event_type =
 * venue_view_milestone) into a short, operational activity line for the
 * Founder Control Panel's venue Internal Notes section (Phase 1C).
 *
 * Pure and read-only: never writes to customer_success_events, venue_notes,
 * or anywhere else. customer_success_events remains the sole source of
 * truth — callers (see getCustomerSuccessNotesForVenue in
 * src/lib/data/venueNotes.ts) compute this projection fresh on every page
 * load rather than copying it into another table.
 *
 * 'superseded' rows (baseline supersession, or a milestone overtaken by a
 * higher one before it could send) are excluded at the caller's query
 * (`.neq("communication_status", "superseded")`) since they're never
 * meaningful to a Founder — this function still treats one as a defensive
 * no-op if it ever sees one directly.
 *
 * 'skipped' is also hidden for now (Phase 1C correction) — it exists in the
 * CHECK constraint but no current code path in this pipeline ever produces
 * it, and its semantics for a future phase (e.g. an operator-preference
 * opt-out) are not yet defined. Surfacing it now would mean inventing
 * meaning for a state nothing has actually decided yet. A future phase that
 * defines real 'skipped' semantics can add its own case here once there's
 * real data to render. Any other unrecognized status is likewise omitted,
 * never guessed at.
 *
 * Recipient display deliberately never shows more than the delivery
 * snapshot actually holds (metadata_json.deliverySnapshot.recipientFirstName
 * — first name only, no last name is ever captured anywhere in this
 * pipeline) or the recipient_email column. Before a snapshot is locked
 * (i.e. before the first delivery attempt), no recipient is shown at all —
 * there is nothing accurate to show yet.
 */

import { getMilestoneEmailCopy } from "./milestoneEmailCopy";
import { parseDeliverySnapshot } from "./deliverySnapshot";
import { formatDateTime } from "@/lib/controlPanelDateTime";

export type CustomerSuccessMilestoneEventRow = {
  id: string;
  milestone_value: number | null;
  communication_status: string;
  achieved_at: string;
  next_attempt_at: string | null;
  sent_at: string | null;
  last_attempted_at: string | null;
  attempt_count: number;
  recipient_email: string | null;
  recipient_blocked_reason: string | null;
  processing_started_at: string | null;
  metadata_json: unknown;
};

export type FormattedMilestoneNote = {
  id: string;
  note: string;
  /** ISO timestamp — the most representative moment for this activity's status, used for both display and chronological merge ordering. */
  created_at: string;
};

/**
 * Author label for the merged Internal Notes feed's author line — a system
 * activity label, never a fabricated human identity. See
 * getCustomerSuccessNotesForVenue in src/lib/data/venueNotes.ts, which sets
 * this on the computed VenueNote.author_label field (existing
 * manual/system notes are unaffected — they leave author_label unset and
 * keep their current authorship behavior).
 */
export const CUSTOMER_SUCCESS_ACTIVITY_AUTHOR_LABEL = "Happy Hour Compass";

const BLOCKED_REASON_LABEL: Record<string, string> = {
  no_active_recipient: "no active recipient",
  ambiguous_recipient: "ambiguous recipient",
  no_resolvable_timezone: "unresolved venue timezone",
};

function milestoneLabel(milestoneValue: number): string {
  return getMilestoneEmailCopy(milestoneValue)?.displayValue ?? String(milestoneValue);
}

/** "Jocelyn (jfenton@example.com)" if a first name is known, else just the bare email. Null if there's no email at all. */
function recipientDescriptor(firstName: string | null, email: string | null): string | null {
  if (!email) return null;
  return firstName ? `${firstName} (${email})` : email;
}

export function formatCustomerSuccessMilestoneNote(
  row: CustomerSuccessMilestoneEventRow
): FormattedMilestoneNote | null {
  if (row.milestone_value === null) return null;
  if (row.communication_status === "superseded") return null;

  const label = milestoneLabel(row.milestone_value);
  const snapshot = parseDeliverySnapshot(row.metadata_json);
  const recipient = recipientDescriptor(snapshot?.recipientFirstName ?? null, row.recipient_email);
  const id = `cs-${row.id}`;

  switch (row.communication_status) {
    case "sent": {
      const note = recipient
        ? `Customer Success: ${label}-view milestone email sent to ${recipient}.`
        : `Customer Success: ${label}-view milestone email sent.`;
      return { id, note, created_at: row.sent_at ?? row.last_attempted_at ?? row.achieved_at };
    }

    case "processing": {
      return {
        id,
        note: `Customer Success: ${label}-view milestone email is currently being sent.`,
        created_at: row.processing_started_at ?? row.achieved_at,
      };
    }

    case "failed": {
      const attempts = row.attempt_count;
      return {
        id,
        note: `Customer Success: ${label}-view milestone email failed after ${attempts} attempt${attempts === 1 ? "" : "s"} — manual attention required.`,
        created_at: row.last_attempted_at ?? row.achieved_at,
      };
    }

    case "pending": {
      const timestamp = row.next_attempt_at ?? row.achieved_at;

      if (row.recipient_blocked_reason) {
        const reasonText = BLOCKED_REASON_LABEL[row.recipient_blocked_reason] ?? "a data issue";
        return {
          id,
          note: `Customer Success: ${label}-view milestone email blocked — ${reasonText}.`,
          created_at: timestamp,
        };
      }

      if (!row.next_attempt_at) {
        // Momentary state: achieved but not yet picked up by the scheduling
        // pass that computes next_attempt_at. No delivery time to report yet.
        return {
          id,
          note: `Customer Success: ${label}-view milestone achieved — awaiting scheduling.`,
          created_at: timestamp,
        };
      }

      const note = recipient
        ? `Customer Success: ${label}-view milestone email scheduled for ${formatDateTime(row.next_attempt_at)} — ${recipient}.`
        : `Customer Success: ${label}-view milestone email scheduled for ${formatDateTime(row.next_attempt_at)}.`;
      return { id, note, created_at: timestamp };
    }

    default:
      // Unrecognized status — never invented; omit rather than guess.
      return null;
  }
}
