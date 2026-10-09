/**
 * Formats venue_plan_grant_events (and time-based expiry) into venue
 * Internal Notes timeline entries. Pure, client-safe — the server read lives
 * in src/lib/data/venueNotes.ts (getPlanGrantNotesForVenue), projected at
 * read time exactly like Customer Success activity, never copied into
 * venue_notes.
 */

import { grantLabel, type PlanGrant } from "@/lib/planGrants/grantState";
import { lastAccessDateLabel } from "@/lib/planGrants/grantDates";
import { formatDate } from "@/lib/controlPanelDateTime";

export const PLAN_GRANT_ACTIVITY_AUTHOR_LABEL = "Happy Hour Compass";

export type PlanGrantEventRow = {
  id: string;
  grant_id: string;
  event_type: string;
  actor_email: string | null;
  previous_ends_at: string | null;
  new_ends_at: string | null;
  note: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
};

export type PlanGrantTimelineEntry = {
  id: string;
  note: string;
  createdAt: string;
  /** Real founder for founder actions; null for system events (author label used). */
  actorEmail: string | null;
};

function endLabel(endsAt: string | null): string {
  return endsAt ? `access through ${lastAccessDateLabel(endsAt)}` : "no expiry";
}

export function formatPlanGrantEvent(event: PlanGrantEventRow, grant: PlanGrant | undefined): PlanGrantTimelineEntry | null {
  const label = grant ? grantLabel(grant) : "Plan grant";
  const reason = event.note ? ` Reason: ${event.note}` : "";
  let note: string;
  switch (event.event_type) {
    case "granted": {
      const scheduled = event.metadata_json?.scheduled === true;
      const startsAt = typeof event.metadata_json?.startsAt === "string" ? event.metadata_json.startsAt : null;
      note = scheduled && startsAt
        ? `${label} scheduled to start ${formatDate(startsAt)} (${endLabel(event.new_ends_at)}). Non-paying grant.${reason}`
        : `${label} granted (${endLabel(event.new_ends_at)}). Non-paying grant.${reason}`;
      break;
    }
    case "extended":
      note = `${label} extended: ${endLabel(event.previous_ends_at)} → ${endLabel(event.new_ends_at)}.${reason}`;
      break;
    case "expiry_added":
      note = `${label} expiry added: ${endLabel(event.new_ends_at)}.${reason}`;
      break;
    case "expiry_shortened":
      note = `${label} end date shortened: ${endLabel(event.previous_ends_at)} → ${endLabel(event.new_ends_at)}.${reason}`;
      break;
    case "revoked":
      note = `${label} revoked.${reason}`;
      break;
    case "cancelled_before_start":
      note = `Scheduled ${label} cancelled before it started.${reason}`;
      break;
    case "ownership_changed":
      note = `${label} ended permanently — venue ownership changed (release or transfer).`;
      break;
    case "venue_cancelled":
      note = `${label} ended permanently — venue cancelled.`;
      break;
    default:
      return null;
  }
  return { id: `grant-event-${event.id}`, note, createdAt: event.created_at, actorEmail: event.actor_email };
}

/**
 * Expiry has no event row (it's time-based). One synthetic entry per grant
 * whose ends_at has passed without an earlier revocation.
 */
export function formatPlanGrantExpiry(grant: PlanGrant, nowMs: number): PlanGrantTimelineEntry | null {
  if (!grant.endsAt) return null;
  const ends = Date.parse(grant.endsAt);
  if (Number.isNaN(ends) || ends > nowMs) return null;
  if (grant.revokedAt && Date.parse(grant.revokedAt) <= ends) return null;
  return {
    id: `grant-expired-${grant.id}`,
    note: `${grantLabel(grant)} expired (${endLabel(grant.endsAt)}). Access returned to the venue's billing plan; paid-only content above that plan is paused publicly.`,
    createdAt: grant.endsAt,
    actorEmail: null,
  };
}
