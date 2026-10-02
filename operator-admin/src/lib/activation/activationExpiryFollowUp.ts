import type { SupabaseClient } from "@supabase/supabase-js";
import { getVenueViewCounts } from "@/lib/data/viewCounts";
import type { ActivationExpiryFollowUpDetails, ActivationExpiryOrigin } from "@/lib/activation/activationExpiryNotifications";

/**
 * Read-only data gathering for the post-expiry personal follow-up
 * notifications (migration 103). Decides whether a required follow-up is
 * still appropriate — account setup still incomplete AND the lifecycle's
 * operator still owns the originating venue — and, if so, assembles the
 * contact details, total venue views and setup-email history the founder
 * needs for a personal call/email/visit.
 *
 * Never writes anything and never reads or returns a setup link or token.
 *
 * Outcomes:
 *   - ok          → notify with `details`
 *   - ineligible  → permanent: the caller records expiry_follow_up_skip_reason
 *                   and stops processing this row (so it can never starve the
 *                   reconciliation batch)
 *   - error       → transient read failure: retried on a later pass
 */

export type ExpiryFollowUpSkipReason = "activated" | "ownership_changed" | "origin_unresolved";

export type ExpiryFollowUpLoadResult =
  | { kind: "ok"; details: ActivationExpiryFollowUpDetails }
  | { kind: "ineligible"; reason: ExpiryFollowUpSkipReason }
  | { kind: "error"; message: string };

export type ExpiryFollowUpLifecycleRow = {
  id: string;
  operator_id: string;
  origin_type: ActivationExpiryOrigin;
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  started_at: string;
  deadline_at: string;
};

/** Structured note event types that represent an email actually sent toward setup. */
const SETUP_EMAIL_EVENT_TYPES = [
  "reminder_sent",
  "manual_resend",
  "legacy_activation_resumed",
  "final_setup_email_sent",
] as const;

function historyLabel(eventType: string, metadata: unknown): string {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  switch (eventType) {
    case "reminder_sent":
      return Number.isInteger(meta.stage) ? `Reminder ${meta.stage as number}` : "Reminder";
    case "manual_resend":
      return "Resent by founder";
    case "legacy_activation_resumed":
      return "Setup email (tracking started)";
    case "final_setup_email_sent":
      return "Final setup email";
    default:
      return "Setup email";
  }
}

export type ExpiryFollowUpLoadDeps = {
  getViews?: (venueId: string, admin: SupabaseClient) => Promise<number | null>;
};

async function defaultGetViews(venueId: string, admin: SupabaseClient): Promise<number | null> {
  try {
    const counts = await getVenueViewCounts(null, [venueId], admin);
    // getVenueViewCounts() returns an empty map on RPC failure and omits
    // venues with zero views, so "absent" is indistinguishable from 0 —
    // report 0 rather than inventing an error that may not exist.
    return counts.get(venueId) ?? 0;
  } catch {
    return null;
  }
}

/** Pure — phone numbers worth showing, de-duplicated, never empty strings. */
export function collectPhones(candidates: { label: string; value: string | null | undefined }[]): { label: string; value: string }[] {
  const seen = new Set<string>();
  const out: { label: string; value: string }[] = [];
  for (const c of candidates) {
    const value = c.value?.trim();
    if (!value) continue;
    const key = value.replace(/\D/g, "") || value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: c.label, value });
  }
  return out;
}

export async function loadExpiryFollowUpDetails(
  admin: SupabaseClient,
  row: ExpiryFollowUpLifecycleRow,
  deps: ExpiryFollowUpLoadDeps = {}
): Promise<ExpiryFollowUpLoadResult> {
  const getViews = deps.getViews ?? defaultGetViews;

  const { data: operatorRow, error: operatorError } = await admin
    .from("operators")
    .select("email, first_name, last_name, account_activated_at")
    .eq("id", row.operator_id)
    .maybeSingle();
  if (operatorError) return { kind: "error", message: `Operator lookup failed: ${operatorError.message}` };
  if (!operatorRow?.email) return { kind: "ineligible", reason: "origin_unresolved" };
  if (operatorRow.account_activated_at) return { kind: "ineligible", reason: "activated" };

  const origin = row.origin_type;
  const originId = (origin === "claim" ? row.origin_claim_id : row.origin_submission_id) as string | null;
  if (!originId) return { kind: "ineligible", reason: "origin_unresolved" };

  let venueId: string | null = null;
  let originPhones: { label: string; value: string | null }[] = [];
  if (origin === "claim") {
    const { data: claimRow, error } = await admin
      .from("venue_claims")
      .select("venue_id, phone, info_phone")
      .eq("id", originId)
      .maybeSingle();
    if (error) return { kind: "error", message: `Claim lookup failed: ${error.message}` };
    venueId = (claimRow?.venue_id as string | null) ?? null;
    originPhones = [
      { label: "claimant", value: (claimRow?.phone as string | null) ?? null },
      { label: "business, from claim", value: (claimRow?.info_phone as string | null) ?? null },
    ];
  } else {
    const { data: subRow, error } = await admin
      .from("operator_submissions")
      .select("venue_id, info_phone")
      .eq("id", originId)
      .maybeSingle();
    if (error) return { kind: "error", message: `Submission lookup failed: ${error.message}` };
    venueId = (subRow?.venue_id as string | null) ?? null;
    originPhones = [{ label: "business, from submission", value: (subRow?.info_phone as string | null) ?? null }];
  }
  if (!venueId) return { kind: "ineligible", reason: "origin_unresolved" };

  const { data: venueRow, error: venueError } = await admin
    .from("venues")
    .select("id, name, phone, created_by_operator_id")
    .eq("id", venueId)
    .maybeSingle();
  if (venueError) return { kind: "error", message: `Venue lookup failed: ${venueError.message}` };
  if (!venueRow?.name) return { kind: "ineligible", reason: "origin_unresolved" };
  if (venueRow.created_by_operator_id !== row.operator_id) return { kind: "ineligible", reason: "ownership_changed" };

  const totalViews = await getViews(venueId, admin);

  // Setup-email history is informational only — a failed read degrades to
  // "none recorded" rather than blocking the notification.
  const notesTable = origin === "claim" ? "venue_claim_notes" : "operator_submission_notes";
  const notesFk = origin === "claim" ? "claim_id" : "submission_id";
  let setupEmailHistory: ActivationExpiryFollowUpDetails["setupEmailHistory"] = [];
  try {
    const { data: noteRows, error: notesError } = await admin
      .from(notesTable)
      .select("created_at, event_type, metadata_json")
      .eq(notesFk, originId)
      .in("event_type", [...SETUP_EMAIL_EVENT_TYPES])
      .order("created_at", { ascending: true });
    if (!notesError && noteRows) {
      setupEmailHistory = (noteRows as { created_at: string; event_type: string; metadata_json: unknown }[]).map((n) => ({
        label: historyLabel(n.event_type, n.metadata_json),
        at: n.created_at,
      }));
    }
  } catch {
    setupEmailHistory = [];
  }

  return {
    kind: "ok",
    details: {
      lifecycleId: row.id,
      venueId,
      venueName: venueRow.name as string,
      firstName: (operatorRow.first_name as string | null) ?? null,
      lastName: (operatorRow.last_name as string | null) ?? null,
      email: operatorRow.email as string,
      phones: collectPhones([...originPhones, { label: "venue", value: (venueRow.phone as string | null) ?? null }]),
      origin,
      originId,
      startedAt: row.started_at,
      deadlineAt: row.deadline_at,
      totalViews,
      setupEmailHistory,
    },
  };
}
