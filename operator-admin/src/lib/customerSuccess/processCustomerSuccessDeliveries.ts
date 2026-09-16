/**
 * Customer Success milestone delivery processor (Phase 1B, Sections 7-16).
 *
 * Orchestrates one full scheduled pass:
 *   0. KILL SWITCH FIRST (Correction Pass Section 1): if
 *      CUSTOMER_SUCCESS_EMAILS_ENABLED !== "true", return immediately —
 *      NO detection, NO baseline/event creation, NO next_attempt_at
 *      writes, NO claiming, NO stale-processing recovery, NO Resend, NO
 *      Customer Success Slack call, NO Customer Success state mutation of
 *      any kind. Disabled means the whole run is a pure no-op past
 *      reading the env var. This lets code/migrations sit deployed with
 *      the switch off with zero risk of milestones silently piling up as
 *      overdue while disabled, then firing all at once (at an arbitrary
 *      hourly cron time, for a stale detected-at) the moment it's flipped
 *      on. The first ENABLED run is what establishes baselines at the
 *      then-current venue-view state — Phase 1A's existing baseline
 *      design (venueViewMilestones.ts, unchanged) already guarantees that
 *      pass backfills historical crossings as 'superseded', never
 *      'pending' — see processCustomerSuccessDeliveries.test.ts's kill
 *      switch tests for both the "never-run-while-disabled" case and the
 *      "temporarily disabled after already running" case.
 *   1. Run venue-view milestone DETECTION (Phase 1A, unchanged) — so a
 *      newly-crossed higher milestone supersedes a lower still-pending
 *      one BEFORE delivery ever looks at it (Section 16).
 *   2. Recover any stale 'processing' claim left by a crashed run.
 *   3. Compute+persist next_attempt_at for any pending event that doesn't
 *      have one yet (next business day ~3pm venue-local) — or, if the
 *      venue's timezone can't be resolved, block it visibly rather than
 *      guessing (Section 4 / Correction Pass Section 4).
 *   4. Retry the success Slack notification for any 'sent' event that
 *      hasn't had it posted yet — independent of email delivery
 *      (Section 11).
 *   5. Find due pending events and attempt delivery, one at a time, each
 *      atomically claimed first so two overlapping runs can't both send
 *      the same event (Section 12) — and, on that same claim, lock in a
 *      delivery snapshot (Correction Pass Section 2) so every retry of
 *      the SAME event sends materially the same content under the same
 *      idempotency key.
 *
 * Called from src/app/api/cron/customer-success-deliveries/route.ts and
 * from scripts/processCustomerSuccessDeliveries.ts (manual dry-run).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/email";
import { runVenueViewMilestoneDetection, type VenueViewMilestoneDetectionResult } from "./detectVenueViewMilestones";
import { isCustomerSuccessEmailDeliveryEnabled } from "./customerSuccessConfig";
import { resolveVenueTimeZone, computeInitialSendTime } from "./deliveryScheduling";
import { resolveRecipientForOperator, type DeliveryBlockedReason } from "./recipientResolution";
import { decideAfterFailedAttempt, isProcessingStale, customerSuccessIdempotencyKey } from "./deliveryRetryPolicy";
import { parseDeliverySnapshot, type DeliverySnapshot } from "./deliverySnapshot";
import { renderVenueViewMilestoneEmail } from "./milestoneEmailTemplate";
import { getMilestoneEmailCopy } from "./milestoneEmailCopy";
import {
  sendMilestoneSuccessSlackNotification,
  sendMilestoneFailureSlackNotification,
  sendRecipientBlockedSlackNotification,
} from "./customerSuccessSlack";
import { fetchAllRows } from "./pagination";
import type { CustomerSuccessEventType } from "./types";

const EVENT_TYPE: CustomerSuccessEventType = "venue_view_milestone";

/** Approved sender/reply-to (Section 3) — never used for any other HHC email. */
const CUSTOMER_SUCCESS_FROM = "Wayne <wayne@happyhourcompass.com>";
const CUSTOMER_SUCCESS_REPLY_TO = "wayne@happyhourcompass.com";

const MAX_ERROR_LENGTH = 500;

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Injectable email sender — defaults to the real sendTransactionalEmail()
 * (src/lib/email.ts). Lets tests substitute a fake so this module's send/
 * retry/failure logic is exercised without a real Resend call (Resend's
 * own client throws immediately if RESEND_API_KEY isn't set, unlike
 * Slack's sendSlackAcquisitionNotification, which already no-ops safely
 * when its webhook env var is unset — no DI needed there).
 */
type SendEmailFn = typeof sendTransactionalEmail;

export type CustomerSuccessDeliveryResult = {
  /** Whether the kill switch was on for this run. When false, `detection` is null and nothing else ran. */
  enabled: boolean;
  detection: VenueViewMilestoneDetectionResult | null;
  staleRecovered: number;
  newlyScheduled: number;
  timezoneBlocked: number;
  successNotificationsRetried: number;
  attempted: number;
  sent: number;
  retried: number;
  failedTerminal: number;
  recipientBlocked: number;
  errors: { eventId: string; message: string }[];
};

function emptyDisabledResult(): CustomerSuccessDeliveryResult {
  return {
    enabled: false,
    detection: null,
    staleRecovered: 0,
    newlyScheduled: 0,
    timezoneBlocked: 0,
    successNotificationsRetried: 0,
    attempted: 0,
    sent: 0,
    retried: 0,
    failedTerminal: 0,
    recipientBlocked: 0,
    errors: [],
  };
}

export async function processCustomerSuccessDeliveries(
  admin: AdminClient = createAdminClient(),
  now: Date = new Date(),
  sendEmail: SendEmailFn = sendTransactionalEmail
): Promise<CustomerSuccessDeliveryResult> {
  // Kill switch checked BEFORE any Supabase call of any kind — see module header.
  if (!isCustomerSuccessEmailDeliveryEnabled()) {
    return emptyDisabledResult();
  }

  const detection = await runVenueViewMilestoneDetection(admin);

  const result: CustomerSuccessDeliveryResult = {
    enabled: true,
    detection,
    staleRecovered: 0,
    newlyScheduled: 0,
    timezoneBlocked: 0,
    successNotificationsRetried: 0,
    attempted: 0,
    sent: 0,
    retried: 0,
    failedTerminal: 0,
    recipientBlocked: 0,
    errors: [],
  };

  result.staleRecovered = await recoverStaleProcessingEvents(admin, now);
  const scheduling = await scheduleNewlyPendingEvents(admin);
  result.newlyScheduled = scheduling.scheduled;
  result.timezoneBlocked = scheduling.blocked;
  result.successNotificationsRetried = await retryPendingSuccessNotifications(admin);

  const due = await fetchDueEvents(admin, now);

  for (const event of due) {
    try {
      const outcome = await processDueEvent(event, admin, now, sendEmail);
      if (outcome === "sent") { result.attempted++; result.sent++; }
      else if (outcome === "retry") { result.attempted++; result.retried++; }
      else if (outcome === "failed_terminal") { result.attempted++; result.failedTerminal++; }
      else if (outcome === "recipient_blocked") { result.recipientBlocked++; }
      // "already_claimed" — another worker got there first; not an error, not counted.
    } catch (err) {
      result.errors.push({ eventId: event.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}

// ── Stale-processing recovery ───────────────────────────────────────────────

async function recoverStaleProcessingEvents(admin: AdminClient, now: Date): Promise<number> {
  const rows = await fetchAllRows<{ id: string; processing_started_at: string | null }>((from, to) =>
    admin
      .from("customer_success_events")
      .select("id, processing_started_at")
      .eq("event_type", EVENT_TYPE)
      .eq("communication_status", "processing")
      .range(from, to)
  );

  let recovered = 0;
  for (const row of rows) {
    if (!row.processing_started_at) continue;
    if (!isProcessingStale(new Date(row.processing_started_at), now)) continue;

    // Deliberately does NOT touch recipient_email/metadata_json — the
    // locked delivery snapshot (if one was already established) must
    // survive recovery so the retry that follows reuses it unchanged.
    const { error } = await admin
      .from("customer_success_events")
      .update({ communication_status: "pending" })
      .eq("id", row.id)
      .eq("communication_status", "processing");
    if (!error) recovered++;
  }
  return recovered;
}

// ── Compute initial next_attempt_at for newly-pending events ───────────────

async function scheduleNewlyPendingEvents(admin: AdminClient): Promise<{ scheduled: number; blocked: number }> {
  const rows = await fetchAllRows<{
    id: string;
    venue_id: string;
    achieved_at: string;
    milestone_value: number | null;
    recipient_blocked_reason: string | null;
    recipient_blocked_notified_at: string | null;
  }>((from, to) =>
    admin
      .from("customer_success_events")
      .select("id, venue_id, achieved_at, milestone_value, recipient_blocked_reason, recipient_blocked_notified_at")
      .eq("event_type", EVENT_TYPE)
      .eq("communication_status", "pending")
      .is("next_attempt_at", null)
      .range(from, to)
  );

  if (rows.length === 0) return { scheduled: 0, blocked: 0 };

  const venueNames = await fetchVenueNames(rows.map((r) => r.venue_id), admin);

  let scheduled = 0;
  let blocked = 0;
  for (const row of rows) {
    const tzResolution = await resolveVenueTimeZone(row.venue_id, admin);

    if (!tzResolution.ok) {
      await applyBlockedState(
        {
          id: row.id,
          venueName: venueNames.get(row.venue_id) ?? "your venue",
          milestoneValue: row.milestone_value,
          recipientBlockedReason: row.recipient_blocked_reason,
          recipientBlockedNotifiedAt: row.recipient_blocked_notified_at,
        },
        "no_resolvable_timezone",
        admin
      );
      blocked++;
      continue;
    }

    const sendTime = computeInitialSendTime(new Date(row.achieved_at), tzResolution.timeZone);
    const { error } = await admin
      .from("customer_success_events")
      .update({
        next_attempt_at: sendTime.toISOString(),
        // Clear a stale 'no_resolvable_timezone' block now that it resolved
        // (a no-op if it was never blocked in the first place).
        recipient_blocked_reason: null,
        recipient_blocked_notified_at: null,
      })
      .eq("id", row.id)
      .is("next_attempt_at", null); // guard against a race with a concurrent scheduler
    if (!error) scheduled++;
  }
  return { scheduled, blocked };
}

// ── Retry success Slack notifications independent of email send ───────────

async function retryPendingSuccessNotifications(admin: AdminClient): Promise<number> {
  const rows = await fetchAllRows<{
    id: string;
    venue_id: string;
    milestone_value: number | null;
    recipient_email: string | null;
    metadata_json: unknown;
  }>((from, to) =>
    admin
      .from("customer_success_events")
      .select("id, venue_id, milestone_value, recipient_email, metadata_json")
      .eq("event_type", EVENT_TYPE)
      .eq("communication_status", "sent")
      .is("sent_notification_sent_at", null)
      .range(from, to)
  );

  if (rows.length === 0) return 0;

  const venueNames = await fetchVenueNames(rows.map((r) => r.venue_id), admin);

  let retried = 0;
  for (const row of rows) {
    if (!row.recipient_email || row.milestone_value === null) continue;
    const copy = getMilestoneEmailCopy(row.milestone_value);
    if (!copy) continue;

    const snapshot = parseDeliverySnapshot(row.metadata_json);

    const slackResult = await sendMilestoneSuccessSlackNotification({
      venueName: snapshot?.venueName ?? venueNames.get(row.venue_id) ?? "your venue",
      displayValue: copy.displayValue,
      recipientFirstName: snapshot?.recipientFirstName ?? "there",
      recipientEmail: row.recipient_email,
    });

    if (slackResult === "delivered") {
      const { error } = await admin
        .from("customer_success_events")
        .update({ sent_notification_sent_at: new Date().toISOString() })
        .eq("id", row.id);
      if (!error) retried++;
    }
  }
  return retried;
}

// ── Due-event fetch + per-event processing ─────────────────────────────────

type DueEvent = {
  id: string;
  venueId: string;
  operatorId: string | null;
  milestoneValue: number;
  attemptCount: number;
  recipientEmail: string | null;
  /** Raw metadata_json as stored — preserved verbatim when locking the snapshot (see mergeDeliverySnapshotIntoMetadata). */
  rawMetadataJson: unknown;
  deliverySnapshot: DeliverySnapshot | null;
  recipientBlockedReason: string | null;
  recipientBlockedNotifiedAt: string | null;
  venueName: string;
};

async function fetchDueEvents(admin: AdminClient, now: Date): Promise<DueEvent[]> {
  const rows = await fetchAllRows<{
    id: string;
    venue_id: string;
    operator_id: string | null;
    milestone_value: number | null;
    attempt_count: number;
    recipient_email: string | null;
    metadata_json: unknown;
    recipient_blocked_reason: string | null;
    recipient_blocked_notified_at: string | null;
  }>((from, to) =>
    admin
      .from("customer_success_events")
      .select(
        "id, venue_id, operator_id, milestone_value, attempt_count, recipient_email, metadata_json, recipient_blocked_reason, recipient_blocked_notified_at"
      )
      .eq("event_type", EVENT_TYPE)
      .eq("communication_status", "pending")
      .not("next_attempt_at", "is", null)
      .lte("next_attempt_at", now.toISOString())
      .range(from, to)
  );

  const withMilestone = rows.filter((r): r is typeof rows[number] & { milestone_value: number } => r.milestone_value !== null);
  const venueNames = await fetchVenueNames(withMilestone.map((r) => r.venue_id), admin);

  return withMilestone.map((r) => ({
    id: r.id,
    venueId: r.venue_id,
    operatorId: r.operator_id,
    milestoneValue: r.milestone_value,
    attemptCount: r.attempt_count,
    recipientEmail: r.recipient_email,
    rawMetadataJson: r.metadata_json,
    deliverySnapshot: parseDeliverySnapshot(r.metadata_json),
    recipientBlockedReason: r.recipient_blocked_reason,
    recipientBlockedNotifiedAt: r.recipient_blocked_notified_at,
    venueName: venueNames.get(r.venue_id) ?? "your venue",
  }));
}

async function fetchVenueNames(venueIds: string[], admin: AdminClient): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(venueIds)];
  if (uniqueIds.length === 0) return new Map();
  const rows = await fetchAllRows<{ id: string; name: string | null }>((from, to) =>
    admin.from("venues").select("id, name").in("id", uniqueIds).range(from, to)
  );
  return new Map(rows.map((r) => [r.id, r.name ?? "your venue"]));
}

// ── Delivery snapshot (Correction Pass Section 2) ───────────────────────────
// parseDeliverySnapshot/DeliverySnapshot now live in ./deliverySnapshot.ts —
// imported above — so a read-only caller (e.g. Founder Control Panel note
// formatting) can reuse the same parsing without importing this module.

/**
 * Merges the delivery snapshot into metadata_json WITHOUT discarding any
 * other top-level keys already present — metadata_json is documented
 * (migration 093/095) as general-purpose optional context for future
 * event types, so locking the delivery snapshot must never clobber
 * whatever else might already be stored there. Only object-shaped existing
 * values are preserved (anything else — null, an array, a primitive — is
 * treated as "nothing to preserve" rather than merged into unexpectedly).
 */
function mergeDeliverySnapshotIntoMetadata(existingMetadataJson: unknown, snapshot: DeliverySnapshot): Record<string, unknown> {
  const base =
    existingMetadataJson && typeof existingMetadataJson === "object" && !Array.isArray(existingMetadataJson)
      ? (existingMetadataJson as Record<string, unknown>)
      : {};
  return { ...base, deliverySnapshot: snapshot };
}

type DueEventOutcome = "sent" | "retry" | "failed_terminal" | "recipient_blocked" | "already_claimed";

async function processDueEvent(
  event: DueEvent,
  admin: AdminClient,
  now: Date,
  sendEmail: SendEmailFn
): Promise<DueEventOutcome> {
  const hasSnapshot = event.recipientEmail !== null;

  let recipientEmail: string;
  let recipientFirstName: string;
  let venueNameForEmail: string;
  let claimPatch: Record<string, unknown> | undefined;

  if (hasSnapshot) {
    // A provider attempt has already begun for this event — reuse the
    // locked snapshot unchanged, never re-resolve. Falls back defensively
    // if metadata_json is somehow missing/malformed (should not happen).
    recipientEmail = event.recipientEmail!;
    recipientFirstName = event.deliverySnapshot?.recipientFirstName ?? "there";
    venueNameForEmail = event.deliverySnapshot?.venueName ?? event.venueName;
  } else {
    if (!event.operatorId) {
      // Structurally shouldn't happen for an eligible venue's event, but
      // treat identically to "no recipient" rather than throwing.
      await applyBlockedState(event, "no_active_recipient", admin);
      return "recipient_blocked";
    }

    // Recipient is re-resolved fresh on every pass until a snapshot is
    // locked — including for a previously-blocked event — so it recovers
    // automatically once account data is fixed, with no manual reset
    // needed (Section 2). Once a snapshot exists (above), this branch is
    // never reached again for this event.
    const recipientResolution = await resolveRecipientForOperator(event.operatorId, admin);

    if (!recipientResolution.ok) {
      await applyBlockedState(event, recipientResolution.reason, admin);
      return "recipient_blocked";
    }

    recipientEmail = recipientResolution.recipient.email;
    recipientFirstName = recipientResolution.recipient.firstName;
    venueNameForEmail = event.venueName;

    // Locked in the SAME atomic UPDATE as the claim below — see claimEvent().
    // Merges into (never replaces) any pre-existing metadata_json content.
    claimPatch = {
      recipient_email: recipientEmail,
      metadata_json: mergeDeliverySnapshotIntoMetadata(event.rawMetadataJson, { recipientFirstName, venueName: venueNameForEmail }),
      recipient_blocked_reason: null,
      recipient_blocked_notified_at: null,
    };
  }

  const claimed = await claimEvent(event.id, now, admin, claimPatch);
  if (!claimed) return "already_claimed";

  const copy = getMilestoneEmailCopy(event.milestoneValue);
  if (!copy) {
    // Should be unreachable — fetchDueEvents only returns real milestone
    // values, which always have approved copy. Release the claim rather
    // than leaving it stuck in 'processing'.
    await admin.from("customer_success_events").update({ communication_status: "pending" }).eq("id", event.id);
    throw new Error(`No approved copy for milestone ${event.milestoneValue}`);
  }

  const rendered = renderVenueViewMilestoneEmail({
    milestone: event.milestoneValue,
    firstName: recipientFirstName,
    venueName: venueNameForEmail,
  });

  const idempotencyKey = customerSuccessIdempotencyKey(event.id);
  const attemptNumber = event.attemptCount + 1;

  const sendResult = await sendEmail({
    type: "customer_success_milestone",
    to: recipientEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // "standard" → sendTransactionalEmail's own ops-critical/ops-alerts
    // escalation never fires; Customer Success owns its own Slack
    // messaging below so the two paths never post duplicate alerts.
    criticality: "standard",
    from: CUSTOMER_SUCCESS_FROM,
    replyTo: CUSTOMER_SUCCESS_REPLY_TO,
    idempotencyKey,
  });

  if (sendResult.ok) {
    await admin
      .from("customer_success_events")
      .update({
        communication_status: "sent",
        sent_at: now.toISOString(),
        provider_message_id: sendResult.id ?? null,
        attempt_count: attemptNumber,
        last_attempted_at: now.toISOString(),
        last_error: null,
      })
      .eq("id", event.id);

    const slackResult = await sendMilestoneSuccessSlackNotification({
      venueName: venueNameForEmail,
      displayValue: copy.displayValue,
      recipientFirstName,
      recipientEmail,
    });
    if (slackResult === "delivered") {
      await admin
        .from("customer_success_events")
        .update({ sent_notification_sent_at: new Date().toISOString() })
        .eq("id", event.id);
    }
    // A failed Slack post here is picked up later by
    // retryPendingSuccessNotifications() — the email stays 'sent' either way.

    return "sent";
  }

  const sanitizedError = sanitizeError(sendResult.error);
  const decision = decideAfterFailedAttempt(attemptNumber, now);

  if (decision.action === "retry") {
    await admin
      .from("customer_success_events")
      .update({
        communication_status: "pending",
        attempt_count: attemptNumber,
        next_attempt_at: decision.nextAttemptAt.toISOString(),
        last_attempted_at: now.toISOString(),
        last_error: sanitizedError,
      })
      .eq("id", event.id);

    await sendMilestoneFailureSlackNotification({
      venueName: venueNameForEmail,
      displayValue: copy.displayValue,
      recipientEmail,
      attemptNumber,
      willRetry: true,
      nextRetryAt: decision.nextAttemptAt,
      errorSummary: sanitizedError,
    });
    return "retry";
  }

  await admin
    .from("customer_success_events")
    .update({
      communication_status: "failed",
      attempt_count: attemptNumber,
      next_attempt_at: null,
      last_attempted_at: now.toISOString(),
      last_error: sanitizedError,
    })
    .eq("id", event.id);

  await sendMilestoneFailureSlackNotification({
    venueName: venueNameForEmail,
    displayValue: copy.displayValue,
    recipientEmail,
    attemptNumber,
    willRetry: false,
    nextRetryAt: null,
    errorSummary: sanitizedError,
  });
  return "failed_terminal";
}

/**
 * Atomic conditional claim: only succeeds if the row is still 'pending'.
 * `snapshotPatch`, when given (first attempt only — see processDueEvent),
 * is merged into the SAME UPDATE so the delivery snapshot is locked in
 * exactly the moment the claim succeeds, not as a separate follow-up call.
 */
async function claimEvent(
  eventId: string,
  now: Date,
  admin: AdminClient,
  snapshotPatch?: Record<string, unknown>
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    communication_status: "processing",
    processing_started_at: now.toISOString(),
    ...snapshotPatch,
  };
  const { data, error } = await admin
    .from("customer_success_events")
    .update(patch)
    .eq("id", eventId)
    .eq("communication_status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

async function applyBlockedState(
  event: {
    id: string;
    venueName: string;
    milestoneValue: number | null;
    recipientBlockedReason: string | null;
    recipientBlockedNotifiedAt: string | null;
  },
  reason: DeliveryBlockedReason,
  admin: AdminClient
): Promise<void> {
  const alreadyNotifiedForSameReason = event.recipientBlockedReason === reason && event.recipientBlockedNotifiedAt !== null;

  const patch: Record<string, string | null> = { recipient_blocked_reason: reason };
  if (!alreadyNotifiedForSameReason) patch.recipient_blocked_notified_at = new Date().toISOString();

  await admin.from("customer_success_events").update(patch).eq("id", event.id);

  if (!alreadyNotifiedForSameReason) {
    const copy = event.milestoneValue !== null ? getMilestoneEmailCopy(event.milestoneValue) : null;
    await sendRecipientBlockedSlackNotification({
      venueName: event.venueName,
      displayValue: copy?.displayValue ?? String(event.milestoneValue ?? "?"),
      reason,
    });
  }
}

function sanitizeError(error: string | undefined): string {
  const raw = error ?? "Unknown error";
  return raw.length > MAX_ERROR_LENGTH ? `${raw.slice(0, MAX_ERROR_LENGTH)}…` : raw;
}
