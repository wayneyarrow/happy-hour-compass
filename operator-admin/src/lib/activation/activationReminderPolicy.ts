/**
 * Pure, deterministic policy functions for the operator-activation
 * reminder/expiry system (Phase 2A-2 — schema + policy foundation only).
 *
 * NO I/O — no Supabase, no email, no Slack. Nothing in this module is wired
 * into a cron, an orchestrator, or a kill switch yet; importing it has zero
 * runtime effect. See CLAUDE.md's Operator activation lifecycle section for
 * the current implementation boundary.
 *
 * TIMING — deadline-relative, not start-relative. A deadline extension
 * (extendActivationDeadlineImpl.ts) only ever moves deadline_at, never
 * started_at, so anchoring every reminder due-time to the deadline is what
 * lets an extension/reopen recompute reminder timing correctly with no
 * special-casing — see computeExtensionResolution() below.
 *
 * reminder_stage SEMANTICS — read before using reminder_stage anywhere:
 * it records the highest stage durably RESOLVED (sent, skipped-as-
 * superseded by a later stage's send, or made obsolete by an extension) —
 * never "how many reminders were actually delivered." Only the
 * corresponding reminder_sent Internal Note (see reminderEventKey() below)
 * proves an actual delivery for a given stage.
 */

export const REMINDER_STAGE_MIN = 0;
export const REMINDER_STAGE_MAX = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Deadline-relative offset, in days, for each reminder stage's due time. */
const STAGE_OFFSET_DAYS: Record<1 | 2 | 3, number> = {
  1: -11,
  2: -7,
  3: -2,
};

function assertValidReminderStage(stage: number, fnName: string): void {
  if (!Number.isInteger(stage) || stage < REMINDER_STAGE_MIN || stage > REMINDER_STAGE_MAX) {
    throw new Error(`${fnName}: invalid reminder stage ${stage} — must be an integer between ${REMINDER_STAGE_MIN} and ${REMINDER_STAGE_MAX}.`);
  }
}

function assertValidStageNumber(stage: number, fnName: string): void {
  if (!Number.isInteger(stage) || stage < 1 || stage > 3) {
    throw new Error(`${fnName}: invalid stage ${stage} — must be an integer 1, 2, or 3.`);
  }
}

/**
 * The due timestamp for a single reminder stage, relative to the
 * lifecycle's OWN deadline_at — never relative to started_at (see module
 * header). Stage 1 = deadline - 11 days, Stage 2 = deadline - 7 days,
 * Stage 3 = deadline - 2 days.
 */
export function computeStageDue(stage: 1 | 2 | 3, deadlineAt: string): string {
  assertValidStageNumber(stage, "computeStageDue");
  const offsetDays = STAGE_OFFSET_DAYS[stage];
  return new Date(new Date(deadlineAt).getTime() + offsetDays * MS_PER_DAY).toISOString();
}

/**
 * First-ever computation of reminder_next_attempt_at for a lifecycle the
 * reminder system has never touched (lazy initialization — see CLAUDE.md).
 * Deliberately does NOT walk/skip stages the way computeExtensionResolution()
 * does: nothing about the deadline changed here, so the raw next-stage due
 * time is returned as-is, even if it's already in the past. A future
 * orchestrator's own due-query + selectCatchUpStage() is what safely
 * handles an already-overdue value — never this function.
 */
export function computeInitialNextAttempt(reminderStage: number, deadlineAt: string): string | null {
  assertValidReminderStage(reminderStage, "computeInitialNextAttempt");
  if (reminderStage === REMINDER_STAGE_MAX) return null;
  return computeStageDue((reminderStage + 1) as 1 | 2 | 3, deadlineAt);
}

export type ExtensionResolution = {
  /** The new reminder_stage after resolving any now-obsolete stages. */
  resolvedStage: number;
  /** The new reminder_next_attempt_at, or null if resolvedStage is 3. */
  nextAttemptAt: string | null;
};

/**
 * Resolves how far reminder_stage should advance when a lifecycle's
 * deadline is extended or reopened. Silently resolves (never sends a
 * reminder for) any stage whose NEW due time is already <= the extension's
 * own transaction time — the deadline moving is what made that stage's
 * original timing obsolete, not a delivery. Stops at the first stage still
 * strictly in the future and schedules that one. Never repeats a stage
 * already resolved before the extension (the walk only ever starts from
 * the current reminderStage forward).
 *
 * `transactionTime` must be the SAME instant used to compute the new
 * deadline_at itself (one authoritative snapshot for the whole extension),
 * so resolution and the deadline it's evaluated against are never
 * computed from two different clock reads.
 */
export function computeExtensionResolution(
  reminderStage: number,
  newDeadlineAt: string,
  transactionTime: string
): ExtensionResolution {
  assertValidReminderStage(reminderStage, "computeExtensionResolution");
  const txMs = new Date(transactionTime).getTime();

  let stage = reminderStage;
  while (stage < REMINDER_STAGE_MAX) {
    const nextStage = (stage + 1) as 1 | 2 | 3;
    const dueMs = new Date(computeStageDue(nextStage, newDeadlineAt)).getTime();
    if (dueMs <= txMs) {
      stage = nextStage;
    } else {
      break;
    }
  }

  const nextAttemptAt = stage === REMINDER_STAGE_MAX ? null : computeStageDue((stage + 1) as 1 | 2 | 3, newDeadlineAt);
  return { resolvedStage: stage, nextAttemptAt };
}

/**
 * Selects which single reminder stage (if any) a processing pass should
 * send THIS pass, given the lifecycle's current resolved stage and
 * deadline. Never returns more than one stage: if multiple are overdue,
 * only the latest (highest-numbered) unresolved one is returned — every
 * lower one is resolved as a side effect of that one send, never sent
 * itself (the approved catch-up policy: "never send multiple reminders in
 * one pass"). Returns null when expiry takes precedence (deadline_at has
 * already passed — no reminder is sent once expiry applies) or when no
 * unresolved stage is currently due.
 */
export function selectCatchUpStage(reminderStage: number, deadlineAt: string, now: string): number | null {
  assertValidReminderStage(reminderStage, "selectCatchUpStage");
  const nowMs = new Date(now).getTime();
  const deadlineMs = new Date(deadlineAt).getTime();

  if (deadlineMs <= nowMs) return null; // expiry takes precedence — no reminder is sent

  let selected: number | null = null;
  for (let stage = reminderStage + 1; stage <= REMINDER_STAGE_MAX; stage++) {
    const dueMs = new Date(computeStageDue(stage as 1 | 2 | 3, deadlineAt)).getTime();
    if (dueMs <= nowMs) selected = stage;
  }
  return selected;
}

// ── Deterministic keys ──────────────────────────────────────────────────────
//
// Every key here is built ONLY from a lifecycle id and (for reminders) a
// stage number — never an email address, setup link, token, or token hash.
//
// reminderKey() intentionally serves BOTH as the Resend idempotency key for
// a reminder send AND as the event_key for that reminder's Internal Note —
// the SAME string, by design (see the Phase 2A design audit): using one
// key for both purposes means the two can never drift apart, and makes the
// note's own existence sufficient proof that stage was durably resolved by
// an actual delivery (see reminder_stage's semantics above). The two names
// below are exported separately only to make each call site's intent
// self-documenting — they are guaranteed identical by construction.

function reminderKey(lifecycleId: string, stage: number): string {
  assertValidStageNumber(stage, "reminderKey");
  return `hhc-activation-reminder:${lifecycleId}:${stage}`;
}

/** Resend idempotency key for a reminder send. Identical to reminderEventKey() by design — see module notes above. */
export const reminderIdempotencyKey = reminderKey;

/** event_key for the reminder_sent Internal Note. Identical to reminderIdempotencyKey() by design — see module notes above. */
export const reminderEventKey = reminderKey;

/** event_key for the one-time activation_expired Internal Note. */
export function expiryEventKey(lifecycleId: string): string {
  return `hhc-activation-expiry:${lifecycleId}`;
}

/**
 * Resend idempotency key for the one-time expiry founder-notification
 * email. Deliberately a DIFFERENT string from expiryEventKey() — the note
 * and the founder email are two independently-retryable side effects (see
 * the Phase 2A design audit's expiry reconciliation design), so they must
 * never share one key.
 */
export function expiryFounderEmailIdempotencyKey(lifecycleId: string): string {
  return `hhc-activation-expiry-founder-email:${lifecycleId}`;
}
