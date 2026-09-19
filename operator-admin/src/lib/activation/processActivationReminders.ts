/**
 * Operator-activation reminder/expiry worker (Phase 2A-3).
 *
 * TWO ENTRY POINTS, deliberately separate exported functions rather than a
 * single function with a caller-controlled `dryRun` flag on its public deps
 * type — this makes "a live caller can never accidentally get planning mode
 * (or vice versa)" a TYPE-LEVEL guarantee, not just a convention:
 *
 *   - processActivationReminders(deps: ProcessActivationRemindersDeps) — the
 *     LIVE entry. isOperatorActivationReminderProcessingEnabled() is checked
 *     as the literal first line, before any Supabase client is even
 *     created. When disabled, this performs ZERO reads, ZERO writes, and
 *     ZERO external calls. This is the ONLY function the cron route
 *     imports/calls (with zero arguments) — there is no `dryRun` field on
 *     its deps type at all, so no caller of this function, network-reached
 *     or otherwise, can select planning mode through it.
 *
 *   - planActivationReminders(deps: ProcessActivationRemindersDeps) — the
 *     read-only planning entry (scripts/processActivationReminders.ts and
 *     tests only). Deliberately NEVER checks the kill switch — a CLI
 *     preview must remain usable while OPERATOR_ACTIVATION_REMINDERS_ENABLED
 *     stays unset in every environment, which is the normal, expected state
 *     today. Its safety comes entirely from internal `if (!dryRun) { ... }`
 *     guards around every mutating Supabase call and every external call
 *     (email, Slack) in this file, forced permanently true — not from the
 *     kill switch. The cron route never imports this function.
 *
 * Both funnel into the same internal runActivationReminderPass(), which
 * structurally mirrors src/lib/customerSuccess/processCustomerSuccessDeliveries.ts
 * (stale-lease recovery → lazy scheduling → due-item processing →
 * reconciliation → sanitized summary) while implementing the
 * activation-specific rules reviewed across the Phase 2A design audit:
 *   - reminder_stage means "highest stage durably resolved," never
 *     "reminders actually sent" — see activationReminderPolicy.ts.
 *   - Catch-up sends at most ONE reminder per lifecycle per pass — never a
 *     burst of skipped stages.
 *   - A note MUST exist before a stage is ever acknowledged as resolved —
 *     see processReminderCandidate()'s send sequence.
 *   - Expiry and reminder are independent CAS transitions; expiry always
 *     takes precedence when a deadline has passed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";
import { sendSlackAlert } from "@/lib/slack";
import { writeActivationNote } from "@/lib/activation/activationNotes";
import { isOperatorActivationReminderProcessingEnabled } from "@/lib/activation/activationReminderConfig";
import {
  computeInitialNextAttempt,
  computeStageDue,
  selectCatchUpStage,
  reminderEventKey,
  expiryEventKey,
} from "@/lib/activation/activationReminderPolicy";
import { sendActivationReminderEmail, type ActivationReminderStage } from "@/lib/activation/activationReminderEmails";
import {
  sendActivationExpirySlackNotification,
  sendActivationExpiryFounderEmail,
  type ActivationExpiryOrigin,
} from "@/lib/activation/activationExpiryNotifications";

const STALE_LEASE_MINUTES = 15;
const MAX_REMINDER_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60 * 60 * 1000; // ~1 hour
const REMINDER_BATCH_LIMIT = 25;
const EXPIRY_BATCH_LIMIT = 25;
const MAX_ERROR_LENGTH = 500;

type AdminClient = SupabaseClient;

// ── Result shape ─────────────────────────────────────────────────────────────

export type PlannedAction =
  | { type: "lazy_init"; lifecycleId: string; nextAttemptAt: string | null }
  | { type: "expiry_transition"; lifecycleId: string }
  | { type: "expiry_note"; lifecycleId: string }
  | { type: "expiry_slack"; lifecycleId: string }
  | { type: "expiry_founder_email"; lifecycleId: string }
  | { type: "reminder_send"; lifecycleId: string; stage: ActivationReminderStage; to: string };

export type ActivationReminderProcessingResult = {
  enabled: boolean;
  dryRun: boolean;
  staleLeasesRecovered: number;
  lazilyInitialized: number;
  expiryTransitioned: number;
  expiryNotesWritten: number;
  expirySlackSent: number;
  expiryFounderEmailsSent: number;
  reminderAttempted: number;
  reminderSent: number;
  reminderFailedRetryable: number;
  reminderFailedExhausted: number;
  reminderSkippedRaced: number;
  reminderSkippedActivated: number;
  reminderSkippedUnresolvedOrigin: number;
  /** Only ever populated when dryRun is true. */
  plannedActions: PlannedAction[];
  errors: { lifecycleId: string; message: string }[];
};

/** Used verbatim for the LIVE kill-switch-disabled no-op return. */
function emptyDisabledResult(): ActivationReminderProcessingResult {
  return {
    enabled: false,
    dryRun: false,
    ...zeroCounters(),
  };
}

/** Used as the starting accumulator for a real pass (live-enabled or planning). */
function freshResult(enabled: boolean, dryRun: boolean): ActivationReminderProcessingResult {
  return { enabled, dryRun, ...zeroCounters() };
}

function zeroCounters(): Omit<ActivationReminderProcessingResult, "enabled" | "dryRun"> {
  return {
    staleLeasesRecovered: 0,
    lazilyInitialized: 0,
    expiryTransitioned: 0,
    expiryNotesWritten: 0,
    expirySlackSent: 0,
    expiryFounderEmailsSent: 0,
    reminderAttempted: 0,
    reminderSent: 0,
    reminderFailedRetryable: 0,
    reminderFailedExhausted: 0,
    reminderSkippedRaced: 0,
    reminderSkippedActivated: 0,
    reminderSkippedUnresolvedOrigin: 0,
    plannedActions: [],
    errors: [],
  };
}

function sanitizeError(error: string | undefined | null): string {
  const raw = error ?? "Unknown error";
  return raw.length > MAX_ERROR_LENGTH ? `${raw.slice(0, MAX_ERROR_LENGTH)}…` : raw;
}

// ── Dependency injection (plain module — never "use server") ───────────────
//
// Every real call site (the cron route, the dry-run script) omits `deps`
// entirely and gets every real implementation. Only tests inject fakes.
// Deliberately has NO `dryRun` field: that is never caller-controlled data
// on either exported entry point — see the two thin wrappers below.

export type ProcessActivationRemindersDeps = {
  adminClient?: AdminClient;
  now?: Date;
  sendReminderEmail?: typeof sendActivationReminderEmail;
  sendExpirySlack?: typeof sendActivationExpirySlackNotification;
  sendExpiryFounderEmail?: typeof sendActivationExpiryFounderEmail;
  writeNote?: typeof writeActivationNote;
};

/**
 * LIVE entry point. The only function the cron route ever imports/calls,
 * always with zero arguments. Checked-first kill switch; zero I/O of any
 * kind while disabled. See module header.
 */
export async function processActivationReminders(
  deps: ProcessActivationRemindersDeps = {}
): Promise<ActivationReminderProcessingResult> {
  if (!isOperatorActivationReminderProcessingEnabled()) {
    return emptyDisabledResult();
  }
  return runActivationReminderPass(deps, /* dryRun */ false);
}

/**
 * Read-only planning entry point — see module header for why this
 * intentionally never checks the kill switch. Only ever called from
 * scripts/processActivationReminders.ts (which itself requires the literal
 * --dry-run CLI flag and has no live-mode option) and from tests. Not
 * imported by the cron route.
 */
export async function planActivationReminders(
  deps: ProcessActivationRemindersDeps = {}
): Promise<ActivationReminderProcessingResult> {
  return runActivationReminderPass(deps, /* dryRun */ true);
}

async function runActivationReminderPass(
  deps: ProcessActivationRemindersDeps,
  dryRun: boolean
): Promise<ActivationReminderProcessingResult> {
  const admin = deps.adminClient ?? createAdminClient();
  const now = deps.now ?? new Date();
  const sendReminderEmail = deps.sendReminderEmail ?? sendActivationReminderEmail;
  const sendExpirySlack = deps.sendExpirySlack ?? sendActivationExpirySlackNotification;
  const sendExpiryFounderEmail = deps.sendExpiryFounderEmail ?? sendActivationExpiryFounderEmail;
  const writeNote = deps.writeNote ?? writeActivationNote;

  // `enabled` here is purely informational — it reports the persistent kill
  // switch's real current value, but (for a planning pass) never gates
  // whether this pass actually reads/plans. Only the LIVE wrapper above
  // uses this switch to decide whether to run at all.
  const result = freshResult(isOperatorActivationReminderProcessingEnabled(), dryRun);

  // ── 1. Stale-lease recovery (dry-run never recovers/clears a lease) ──────
  if (!dryRun) {
    result.staleLeasesRecovered = await recoverStaleLeases(admin, now);
  }

  // ── 2. Lazy initialization ────────────────────────────────────────────────
  result.lazilyInitialized = await lazilyInitializeEligibleRows(admin, dryRun, result.plannedActions);

  // ── 3. Expired/deadline-due rows FIRST — the CAS transition only ─────────
  result.expiryTransitioned = await transitionDueExpiries(admin, now, dryRun, result.plannedActions, result.errors);

  // ── 4. Due reminders SECOND ───────────────────────────────────────────────
  await processDueReminders(admin, now, dryRun, result, sendReminderEmail, writeNote);

  // ── 5. Reconcile incomplete expiry side effects ──────────────────────────
  await reconcileExpirySideEffects(admin, dryRun, result, sendExpirySlack, sendExpiryFounderEmail, writeNote);

  return result;
}

// ── Stale-lease recovery ─────────────────────────────────────────────────────

async function recoverStaleLeases(admin: AdminClient, now: Date): Promise<number> {
  const staleThreshold = new Date(now.getTime() - STALE_LEASE_MINUTES * 60_000).toISOString();

  const { data, error } = await admin
    .from("operator_activation_lifecycles")
    .update({ reminder_lease_stage: null, reminder_lease_started_at: null })
    .not("reminder_lease_started_at", "is", null)
    .lt("reminder_lease_started_at", staleThreshold)
    .select("id");

  if (error) {
    console.error("[processActivationReminders] Stale-lease recovery failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

// ── Lazy initialization ──────────────────────────────────────────────────────
//
// Never special-cases any lifecycle by id — every live, unactivated row
// with reminder_next_attempt_at still NULL gets exactly the same treatment,
// including the first real tracked one (Kelly Terris / Buffalo Rouge).

async function lazilyInitializeEligibleRows(
  admin: AdminClient,
  dryRun: boolean,
  plannedActions: PlannedAction[]
): Promise<number> {
  const { data: rows, error } = await admin
    .from("operator_activation_lifecycles")
    .select("id, reminder_stage, deadline_at, operator_id")
    .is("expired_at", null)
    .is("released_at", null)
    .is("reminder_next_attempt_at", null)
    .lt("reminder_stage", 3);

  if (error) {
    console.error("[processActivationReminders] Lazy-init candidate lookup failed:", error.message);
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  const operatorIds = [...new Set(rows.map((r) => r.operator_id as string))];
  const { data: operatorRows, error: opError } = await admin
    .from("operators")
    .select("id, account_activated_at")
    .in("id", operatorIds);

  if (opError) {
    console.error("[processActivationReminders] Lazy-init operator lookup failed:", opError.message);
    return 0;
  }
  const activatedById = new Map((operatorRows ?? []).map((o) => [o.id as string, !!o.account_activated_at]));

  let count = 0;
  for (const row of rows) {
    if (activatedById.get(row.operator_id as string)) continue; // never touch an already-activated operator's row

    const nextAttemptAt = computeInitialNextAttempt(row.reminder_stage as number, row.deadline_at as string);

    if (dryRun) {
      plannedActions.push({ type: "lazy_init", lifecycleId: row.id as string, nextAttemptAt });
      count++;
      continue;
    }

    const { error: updateError } = await admin
      .from("operator_activation_lifecycles")
      .update({ reminder_next_attempt_at: nextAttemptAt })
      .eq("id", row.id as string)
      .is("reminder_next_attempt_at", null); // guard against a race with a concurrent initializer

    if (!updateError) count++;
  }
  return count;
}

// ── Expiry: CAS transition only (side effects handled separately) ──────────

async function transitionDueExpiries(
  admin: AdminClient,
  now: Date,
  dryRun: boolean,
  plannedActions: PlannedAction[],
  errors: { lifecycleId: string; message: string }[]
): Promise<number> {
  const nowIso = now.toISOString();

  const { data: rows, error } = await admin
    .from("operator_activation_lifecycles")
    .select("id, operator_id, deadline_at")
    .is("expired_at", null)
    .is("released_at", null)
    .lte("deadline_at", nowIso)
    .order("deadline_at", { ascending: true })
    .limit(EXPIRY_BATCH_LIMIT);

  if (error) {
    console.error("[processActivationReminders] Expiry-due candidate lookup failed:", error.message);
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  let count = 0;
  for (const row of rows) {
    try {
      // Fresh activation check immediately before the CAS.
      const { data: operatorRow, error: opError } = await admin
        .from("operators")
        .select("account_activated_at")
        .eq("id", row.operator_id as string)
        .maybeSingle();
      if (opError) throw new Error(opError.message);
      if (operatorRow?.account_activated_at) continue; // activated — never expire

      if (dryRun) {
        plannedActions.push({ type: "expiry_transition", lifecycleId: row.id as string });
        count++;
        continue;
      }

      const { data: updated, error: casError } = await admin
        .from("operator_activation_lifecycles")
        .update({ expired_at: now.toISOString() })
        .eq("id", row.id as string)
        .lte("deadline_at", nowIso)
        .is("expired_at", null)
        .is("released_at", null)
        .select("id")
        .maybeSingle();
      if (casError) throw new Error(casError.message);
      if (updated) count++;
    } catch (err) {
      errors.push({ lifecycleId: row.id as string, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return count;
}

// ── Origin/venue resolution (shared by reminder + expiry side effects) ─────

type ResolvedLifecycle = {
  ok: true;
  email: string;
  firstName: string | null;
  lastName: string | null;
  venueName: string;
  origin: ActivationExpiryOrigin;
  originId: string;
  startedAt: string;
} | { ok: false; reason: string };

async function resolveLifecycleDetails(
  admin: AdminClient,
  lifecycleRow: {
    operator_id: string;
    origin_type: "claim" | "submission";
    origin_claim_id: string | null;
    origin_submission_id: string | null;
    started_at: string;
  }
): Promise<ResolvedLifecycle> {
  const { data: operatorRow, error: opError } = await admin
    .from("operators")
    .select("email, first_name, last_name")
    .eq("id", lifecycleRow.operator_id)
    .maybeSingle();
  if (opError || !operatorRow?.email) {
    return { ok: false, reason: "Could not resolve operator email." };
  }

  let venueId: string | null = null;
  const origin: ActivationExpiryOrigin = lifecycleRow.origin_type;
  const originId = (origin === "claim" ? lifecycleRow.origin_claim_id : lifecycleRow.origin_submission_id) as string;

  if (origin === "claim") {
    const { data: claimRow, error: claimError } = await admin
      .from("venue_claims")
      .select("venue_id")
      .eq("id", originId)
      .maybeSingle();
    if (claimError || !claimRow?.venue_id) return { ok: false, reason: "Claim origin no longer resolves to a venue." };
    venueId = claimRow.venue_id as string;
  } else {
    const { data: subRow, error: subError } = await admin
      .from("operator_submissions")
      .select("venue_id")
      .eq("id", originId)
      .maybeSingle();
    if (subError || !subRow?.venue_id) return { ok: false, reason: "Submission origin no longer resolves to a venue." };
    venueId = subRow.venue_id as string;
  }

  const { data: venueRow, error: venueError } = await admin.from("venues").select("name").eq("id", venueId).maybeSingle();
  if (venueError || !venueRow?.name) return { ok: false, reason: "Origin venue no longer resolves." };

  return {
    ok: true,
    email: operatorRow.email as string,
    firstName: (operatorRow.first_name as string | null) ?? null,
    lastName: (operatorRow.last_name as string | null) ?? null,
    venueName: venueRow.name as string,
    origin,
    originId,
    startedAt: lifecycleRow.started_at,
  };
}

// ── Due reminders ────────────────────────────────────────────────────────────

async function processDueReminders(
  admin: AdminClient,
  now: Date,
  dryRun: boolean,
  result: ActivationReminderProcessingResult,
  sendReminderEmail: NonNullable<ProcessActivationRemindersDeps["sendReminderEmail"]>,
  writeNote: NonNullable<ProcessActivationRemindersDeps["writeNote"]>
): Promise<void> {
  const nowIso = now.toISOString();

  const { data: rows, error } = await admin
    .from("operator_activation_lifecycles")
    .select(
      "id, operator_id, origin_type, origin_claim_id, origin_submission_id, started_at, deadline_at, reminder_stage, reminder_attempt_count"
    )
    .is("expired_at", null)
    .is("released_at", null)
    .not("reminder_next_attempt_at", "is", null)
    .lte("reminder_next_attempt_at", nowIso)
    .order("reminder_next_attempt_at", { ascending: true })
    .limit(REMINDER_BATCH_LIMIT);

  if (error) {
    console.error("[processActivationReminders] Due-reminder candidate lookup failed:", error.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    try {
      await processReminderCandidate(admin, row, now, dryRun, result, sendReminderEmail, writeNote);
    } catch (err) {
      result.errors.push({ lifecycleId: row.id as string, message: err instanceof Error ? err.message : String(err) });
    }
  }
}

type ReminderCandidateRow = {
  id: string;
  operator_id: string;
  origin_type: "claim" | "submission";
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  started_at: string;
  deadline_at: string;
  reminder_stage: number;
  reminder_attempt_count: number;
};

async function processReminderCandidate(
  admin: AdminClient,
  row: ReminderCandidateRow,
  now: Date,
  dryRun: boolean,
  result: ActivationReminderProcessingResult,
  sendReminderEmail: NonNullable<ProcessActivationRemindersDeps["sendReminderEmail"]>,
  writeNote: NonNullable<ProcessActivationRemindersDeps["writeNote"]>
): Promise<void> {
  const lifecycleId = row.id;
  const currentStage = row.reminder_stage;
  const deadlineAt = row.deadline_at;

  const selectedStage = selectCatchUpStage(currentStage, deadlineAt, now.toISOString());
  if (selectedStage === null || selectedStage <= currentStage) return; // nothing due, or expiry now takes precedence

  // Fresh activation check BEFORE the lease claim.
  const { data: operatorRow, error: opError } = await admin
    .from("operators")
    .select("account_activated_at")
    .eq("id", row.operator_id)
    .maybeSingle();
  if (opError) throw new Error(opError.message);
  if (operatorRow?.account_activated_at) {
    result.reminderSkippedActivated++;
    return;
  }

  const resolved = await resolveLifecycleDetails(admin, row);
  if (!resolved.ok) {
    result.reminderSkippedUnresolvedOrigin++;
    return;
  }

  if (dryRun) {
    result.plannedActions.push({
      type: "reminder_send",
      lifecycleId,
      stage: selectedStage as ActivationReminderStage,
      to: resolved.email,
    });
    result.reminderAttempted++;
    return;
  }

  // ── Claim lease: pins lifecycle id, current reminder_stage, and requires
  // no existing lease / no expiry / no release. ────────────────────────────
  const leaseClaimAt = now.toISOString();
  const { data: claimedRow, error: claimError } = await admin
    .from("operator_activation_lifecycles")
    .update({ reminder_lease_stage: selectedStage, reminder_lease_started_at: leaseClaimAt })
    .eq("id", lifecycleId)
    .eq("reminder_stage", currentStage)
    .is("reminder_lease_started_at", null)
    .is("expired_at", null)
    .is("released_at", null)
    .select("id, reminder_lease_started_at")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimedRow) {
    result.reminderSkippedRaced++;
    return; // already claimed by another worker, or state moved
  }
  const claimedLeaseStartedAt = claimedRow.reminder_lease_started_at as string;

  result.reminderAttempted++;

  // ── Final pre-send validation — re-read and verify EVERY pinned field. ──
  const { data: freshRow, error: freshError } = await admin
    .from("operator_activation_lifecycles")
    .select("deadline_at, reminder_stage, reminder_lease_stage, reminder_lease_started_at, expired_at, released_at")
    .eq("id", lifecycleId)
    .maybeSingle();
  const { data: freshOperator, error: freshOpError } = await admin
    .from("operators")
    .select("account_activated_at")
    .eq("id", row.operator_id)
    .maybeSingle();

  const stillValid =
    !freshError &&
    !freshOpError &&
    !!freshRow &&
    !freshOperator?.account_activated_at &&
    freshRow.deadline_at === deadlineAt &&
    freshRow.reminder_stage === currentStage &&
    freshRow.reminder_lease_stage === selectedStage &&
    freshRow.reminder_lease_started_at === claimedLeaseStartedAt &&
    freshRow.expired_at === null &&
    freshRow.released_at === null &&
    selectCatchUpStage(currentStage, deadlineAt, now.toISOString()) === selectedStage;

  if (!stillValid) {
    // Abandon — release ONLY the exact lease this worker still owns, never
    // another worker's (or a since-recovered) lease.
    await admin
      .from("operator_activation_lifecycles")
      .update({ reminder_lease_stage: null, reminder_lease_started_at: null })
      .eq("id", lifecycleId)
      .eq("reminder_lease_started_at", claimedLeaseStartedAt);
    result.reminderSkippedRaced++;
    return;
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendResult = await sendReminderEmail({
    stage: selectedStage as ActivationReminderStage,
    lifecycleId,
    to: resolved.email,
    firstName: resolved.firstName,
    venueName: resolved.venueName,
    adminClient: admin,
  });

  if (!sendResult.ok) {
    await handleReminderFailure(admin, {
      lifecycleId,
      selectedStage: selectedStage as ActivationReminderStage,
      attemptCountBefore: row.reminder_attempt_count,
      deadlineAt,
      leaseStartedAt: claimedLeaseStartedAt,
      error: sendResult.error,
      origin: resolved.origin,
      originId: resolved.originId,
      now,
      result,
      writeNote,
    });
    return;
  }

  // ── Note BEFORE acknowledgement — a stage can never be marked resolved-
  // by-delivery without its Internal Note already existing. ──────────────
  const noteResult = await writeNote(
    {
      origin: resolved.origin === "claim" ? { type: "claim", claimId: resolved.originId } : { type: "submission", submissionId: resolved.originId },
      eventType: "reminder_sent",
      note: `Reminder ${selectedStage} sent to ${resolved.email}.`,
      metadata: {
        lifecycleId,
        stage: selectedStage,
        recipient: resolved.email,
        deadline: deadlineAt,
        flow: resolved.origin,
        sentAt: now.toISOString(),
      },
      eventKey: reminderEventKey(lifecycleId, selectedStage),
    },
    admin
  );

  if (!noteResult.ok) {
    // Note insert failed for a real reason (not 23505 — that's treated as
    // success by writeActivationNote itself). Do NOT advance the stage; do
    // NOT release the lease as successful — leave it held for stale-lease
    // recovery to retry the whole sequence. Provider idempotency protects
    // against a duplicate email on that retry; event_key uniqueness
    // protects against a duplicate note.
    const report = reportOperationalError({
      error: new Error(noteResult.error ?? "Unknown note-insert failure"),
      flow: "operator-activation-reminder",
      stage: "note-insert-after-send",
      severity: "warning",
      context: { lifecycleId, selectedStage },
    });
    await sendSlackAlert({
      channel: "ops-alerts",
      severity: "warning",
      title: "Activation reminder sent, but its Internal Note failed to write",
      message: "The reminder email was delivered; the stage will NOT be marked resolved until the note exists. Stale-lease recovery will retry the whole sequence safely.",
      metadata: { "Lifecycle ID": lifecycleId, Stage: selectedStage, "HHC Error": report.hhcErrorId },
    });
    return;
  }

  // ── Guarded acknowledgement — exact match on every pinned field. ────────
  const nextAttemptAt = selectedStage === 3 ? null : computeStageDue((selectedStage + 1) as 1 | 2 | 3, deadlineAt);
  const { data: ackRow, error: ackError } = await admin
    .from("operator_activation_lifecycles")
    .update({
      reminder_stage: selectedStage,
      reminder_lease_stage: null,
      reminder_lease_started_at: null,
      reminder_next_attempt_at: nextAttemptAt,
      reminder_attempt_count: 0,
      reminder_last_attempted_at: null,
      reminder_last_error: null,
    })
    .eq("id", lifecycleId)
    .eq("reminder_stage", currentStage)
    .eq("reminder_lease_stage", selectedStage)
    .eq("reminder_lease_started_at", claimedLeaseStartedAt)
    .eq("deadline_at", deadlineAt)
    .is("expired_at", null)
    .is("released_at", null)
    .select("id")
    .maybeSingle();

  if (ackError) throw new Error(ackError.message);

  if (!ackRow) {
    // Provider already accepted the send AND the note already exists — this
    // is a genuine anomaly, never expected under the corrected design
    // (extension refuses to run while a lease is held, so deadline_at
    // cannot have legitimately changed here). Never resend with a new key
    // — the deterministic key is preserved for stale-lease-recovery retry,
    // which will safely re-run the whole sequence once this lease ages out.
    const report = reportOperationalError({
      error: new Error("Reminder acknowledgement CAS matched zero rows after a successful send"),
      flow: "operator-activation-reminder",
      stage: "acknowledgement",
      severity: "critical",
      context: { lifecycleId, selectedStage },
    });
    await sendSlackAlert({
      channel: "ops-critical",
      severity: "critical",
      title: "Activation reminder acknowledgement inconsistency — manual review required",
      message:
        "The reminder email was delivered and its Internal Note was written, but the stage could not be " +
        "acknowledged — an unexpected concurrent change occurred. The lease is left in place for stale-lease " +
        "recovery; the same idempotency key makes any eventual retry safe.",
      metadata: { "Lifecycle ID": lifecycleId, Stage: selectedStage, "HHC Error": report.hhcErrorId },
    });
    return;
  }

  result.reminderSent++;
}

async function handleReminderFailure(
  admin: AdminClient,
  params: {
    lifecycleId: string;
    selectedStage: ActivationReminderStage;
    attemptCountBefore: number;
    deadlineAt: string;
    leaseStartedAt: string;
    error: string;
    origin: ActivationExpiryOrigin;
    originId: string;
    now: Date;
    result: ActivationReminderProcessingResult;
    writeNote: NonNullable<ProcessActivationRemindersDeps["writeNote"]>;
  }
): Promise<void> {
  const attemptCountAfter = params.attemptCountBefore + 1;
  const sanitizedError = sanitizeError(params.error);
  const exhausted = attemptCountAfter >= MAX_REMINDER_ATTEMPTS;

  // Structured failure note — informational, system-attributed, one per
  // attempt (uniquely keyed by lifecycle+stage+attempt number so retries
  // never collide on event_key).
  await params.writeNote(
    {
      origin: params.origin === "claim" ? { type: "claim", claimId: params.originId } : { type: "submission", submissionId: params.originId },
      eventType: "reminder_delivery_failed",
      note: `Reminder ${params.selectedStage} delivery attempt ${attemptCountAfter} failed: ${sanitizedError}`,
      metadata: { lifecycleId: params.lifecycleId, stage: params.selectedStage, attempt: attemptCountAfter },
      eventKey: `hhc-activation-reminder-failure:${params.lifecycleId}:${params.selectedStage}:${attemptCountAfter}`,
    },
    admin
  );

  await sendSlackAlert({
    channel: "ops-alerts",
    severity: "warning",
    title: "Activation reminder delivery failed",
    message: exhausted
      ? "Final attempt failed — this stage will not be retried further; the next unresolved stage (or expiry) will take over naturally."
      : "Will retry in about an hour.",
    metadata: {
      "Lifecycle ID": params.lifecycleId,
      Stage: params.selectedStage,
      Attempt: `${attemptCountAfter}/${MAX_REMINDER_ATTEMPTS}`,
      Error: sanitizedError,
    },
  });

  if (exhausted) {
    // Give up on THIS stage — never mark it delivered. Move the schedule
    // forward to the NEXT unresolved stage's own natural due time (or null
    // past stage 3); reminder_stage itself is left untouched here — it only
    // ever advances via a real send's guarded acknowledgement, which,
    // because selectCatchUpStage() always returns the LATEST overdue stage,
    // will naturally jump straight to whatever stage eventually succeeds —
    // correctly superseding this exhausted one without ever falsely
    // recording it as delivered. Reminder_attempt_count resets to 0: it is
    // scoped to "attempts against whatever stage selectCatchUpStage
    // currently selects," so a fresh stage always gets a fresh budget.
    //
    // KNOWN ACCEPTED EDGE CASE: if enough real time passes between hourly
    // retries that a HIGHER stage becomes newly due mid-retry-cycle (only
    // possible after a multi-day gap, since retries are ~1h apart and
    // stages are days apart), attempt_count could nominally carry into a
    // stage that was never actually attempted before. This is accepted —
    // matching this system's established "smallest demonstrably
    // recoverable design" philosophy — rather than adding a new persisted
    // per-stage attempt column.
    const nextAttemptAt = params.selectedStage === 3 ? null : computeStageDue((params.selectedStage + 1) as 1 | 2 | 3, params.deadlineAt);
    await admin
      .from("operator_activation_lifecycles")
      .update({
        reminder_lease_stage: null,
        reminder_lease_started_at: null,
        reminder_next_attempt_at: nextAttemptAt,
        reminder_attempt_count: 0,
        reminder_last_attempted_at: params.now.toISOString(),
        reminder_last_error: sanitizedError,
      })
      .eq("id", params.lifecycleId)
      .eq("reminder_lease_started_at", params.leaseStartedAt);
    params.result.reminderFailedExhausted++;
    return;
  }

  await admin
    .from("operator_activation_lifecycles")
    .update({
      reminder_lease_stage: null,
      reminder_lease_started_at: null,
      reminder_next_attempt_at: new Date(params.now.getTime() + RETRY_DELAY_MS).toISOString(),
      reminder_attempt_count: attemptCountAfter,
      reminder_last_attempted_at: params.now.toISOString(),
      reminder_last_error: sanitizedError,
    })
    .eq("id", params.lifecycleId)
    .eq("reminder_lease_started_at", params.leaseStartedAt);
  params.result.reminderFailedRetryable++;
}

// ── Expiry side-effect reconciliation ───────────────────────────────────────

async function reconcileExpirySideEffects(
  admin: AdminClient,
  dryRun: boolean,
  result: ActivationReminderProcessingResult,
  sendExpirySlack: NonNullable<ProcessActivationRemindersDeps["sendExpirySlack"]>,
  sendExpiryFounderEmail: NonNullable<ProcessActivationRemindersDeps["sendExpiryFounderEmail"]>,
  writeNote: NonNullable<ProcessActivationRemindersDeps["writeNote"]>
): Promise<void> {
  const { data: rows, error } = await admin
    .from("operator_activation_lifecycles")
    .select(
      "id, operator_id, origin_type, origin_claim_id, origin_submission_id, started_at, deadline_at, expired_at, expiry_slack_notified_at, expiry_founder_email_sent_at"
    )
    .not("expired_at", "is", null)
    .is("released_at", null)
    .order("expired_at", { ascending: true })
    .limit(EXPIRY_BATCH_LIMIT);

  if (error) {
    console.error("[processActivationReminders] Expiry reconciliation lookup failed:", error.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    try {
      await reconcileOneExpiredLifecycle(admin, row, dryRun, result, sendExpirySlack, sendExpiryFounderEmail, writeNote);
    } catch (err) {
      result.errors.push({ lifecycleId: row.id as string, message: err instanceof Error ? err.message : String(err) });
    }
  }
}

type ExpiredRow = {
  id: string;
  operator_id: string;
  origin_type: "claim" | "submission";
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  started_at: string;
  deadline_at: string;
  expired_at: string;
  expiry_slack_notified_at: string | null;
  expiry_founder_email_sent_at: string | null;
};

async function reconcileOneExpiredLifecycle(
  admin: AdminClient,
  row: ExpiredRow,
  dryRun: boolean,
  result: ActivationReminderProcessingResult,
  sendExpirySlack: NonNullable<ProcessActivationRemindersDeps["sendExpirySlack"]>,
  sendExpiryFounderEmail: NonNullable<ProcessActivationRemindersDeps["sendExpiryFounderEmail"]>,
  writeNote: NonNullable<ProcessActivationRemindersDeps["writeNote"]>
): Promise<void> {
  const resolved = await resolveLifecycleDetails(admin, row);
  if (!resolved.ok) return; // nothing safe to notify with — leave for a future pass / manual review

  // Note — retried every pass until it exists, using event_key uniqueness.
  // PLANNING MODE NEVER CALLS writeNote() AT ALL — not even with a
  // discarded result. The live branch is the only caller of the real
  // (mutating) note writer; dry-run only ever appends the already-decided
  // plannedAction, structurally incapable of an INSERT regardless of what
  // `writeNote` itself is bound to.
  if (dryRun) {
    result.plannedActions.push({ type: "expiry_note", lifecycleId: row.id });
  } else {
    const noteResult = await writeNote(
      {
        origin: resolved.origin === "claim" ? { type: "claim", claimId: resolved.originId } : { type: "submission", submissionId: resolved.originId },
        eventType: "activation_expired",
        note: `Activation expired — deadline was ${row.deadline_at}.`,
        metadata: { lifecycleId: row.id, deadline: row.deadline_at, operatorEmail: resolved.email, flow: resolved.origin },
        eventKey: expiryEventKey(row.id),
      },
      admin
    );
    if (noteResult.ok && noteResult.alreadyExisted === false) {
      result.expiryNotesWritten++;
    }
  }

  // Slack — fresh activation check immediately before send, at-least-once.
  if (!row.expiry_slack_notified_at) {
    const { data: operatorRow } = await admin.from("operators").select("account_activated_at").eq("id", row.operator_id).maybeSingle();
    if (!operatorRow?.account_activated_at) {
      if (dryRun) {
        result.plannedActions.push({ type: "expiry_slack", lifecycleId: row.id });
      } else {
        const slackResult = await sendExpirySlack({
          venueName: resolved.venueName,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
          email: resolved.email,
          origin: resolved.origin,
          originId: resolved.originId,
          startedAt: resolved.startedAt,
          deadlineAt: row.deadline_at,
        });
        if (slackResult === "delivered") {
          await admin.from("operator_activation_lifecycles").update({ expiry_slack_notified_at: new Date().toISOString() }).eq("id", row.id);
          result.expirySlackSent++;
        }
      }
    }
  }

  // Founder email — fresh activation check immediately before send, deterministic idempotency.
  if (!row.expiry_founder_email_sent_at) {
    const { data: operatorRow } = await admin.from("operators").select("account_activated_at").eq("id", row.operator_id).maybeSingle();
    if (!operatorRow?.account_activated_at) {
      if (dryRun) {
        result.plannedActions.push({ type: "expiry_founder_email", lifecycleId: row.id });
      } else {
        const emailResult = await sendExpiryFounderEmail({
          lifecycleId: row.id,
          venueName: resolved.venueName,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
          email: resolved.email,
          origin: resolved.origin,
          originId: resolved.originId,
          deadlineAt: row.deadline_at,
        });
        if (emailResult.ok) {
          await admin.from("operator_activation_lifecycles").update({ expiry_founder_email_sent_at: new Date().toISOString() }).eq("id", row.id);
          result.expiryFounderEmailsSent++;
        }
      }
    }
  }
}
