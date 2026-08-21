import { sendSlackAlert } from "@/lib/slack";
import { upsertBrevoContact, removeBrevoContactFromList } from "./client";
import { classifyThrown, isRetryable, type BrevoErrorClass } from "./errors";
import { maskEmail } from "./maskEmail";
import { getDefaultBrevoAdminClient, type BrevoAdminClient } from "./supabaseAdminClient";

/**
 * Brevo sync outbox processor — claims and processes due rows from
 * public.brevo_sync_outbox (supabase/migrations/075_brevo_sync_outbox.sql).
 *
 * Called from src/app/api/cron/brevo-sync-outbox/route.ts. Consumer lifecycle
 * code (Phase 2A, src/lib/brevo/consumerSync.ts) enqueues the rows this
 * processes.
 *
 * `payload.subscribed` selects the Brevo operation for an `upsert_contact`
 * row (both still use that one outbox `operation` value — see
 * 075_brevo_sync_outbox.sql's CHECK constraint; this is a processing-time
 * branch, not a second outbox operation):
 *   - true/undefined → upsertBrevoContact(): create-or-update the contact
 *     and ensure list membership (unchanged Phase 1 behavior).
 *   - false → removeBrevoContactFromList(): the contact is no longer
 *     eligible for this HHC list. Never deletes the Brevo contact, never
 *     touches emailBlacklisted, never touches any other list — see
 *     client.ts's doc comment for why this is the narrowest correct
 *     operation for "marketing_consent went false."
 */

type OutboxPayload = {
  email: string;
  attributes?: Record<string, string>;
  /**
   * One or more target Brevo lists. Every producer today writes exactly one
   * element EXCEPT the existing-consumer welcome backfill
   * (welcomeCohortBackfill.ts), which writes two (the ongoing consumer list
   * + the dedicated historical-welcome list) for a subscribed:true row. A
   * subscribed:false (removal) row must always carry exactly one — removal
   * is inherently single-list — enforced defensively below.
   */
  listIds: number[];
  subscribed?: boolean;
};

type OutboxRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: OutboxPayload;
  attempt_count: number;
  max_attempts: number;
};

export type ProcessBatchResult = {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  blocked: number;
};

const STALE_PROCESSING_MINUTES = 10;

/**
 * Bounded exponential-ish backoff with a cap, keyed by 1-based attempt
 * number: 1→1min, 2→5min, 3→15min, 4→30min, 5+→60min. No jitter — at this
 * volume/frequency contention between retries isn't a real concern; revisit
 * if that changes.
 */
export function computeBackoffMs(attemptNumber: number): number {
  const stepsMinutes = [1, 5, 15, 30, 60];
  const minutes = stepsMinutes[Math.min(Math.max(attemptNumber, 1) - 1, stepsMinutes.length - 1)];
  return minutes * 60_000;
}

/**
 * Resets rows stuck in 'processing' because a previous processor
 * invocation died mid-batch (crash, cold-start kill, timeout) back to
 * 'pending'. Safe to call every run — a benign race with a concurrent
 * reclaim just produces a harmless redundant no-op UPDATE.
 */
export async function reclaimStaleProcessingRows(
  supabase: BrevoAdminClient = getDefaultBrevoAdminClient()
): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();

  const { data, error } = await supabase
    .from("brevo_sync_outbox")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("last_attempted_at", staleBefore)
    .select("id");

  if (error) {
    console.error("[brevo/outbox] reclaimStaleProcessingRows failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/** Claims and processes up to `limit` due outbox rows in one batch. */
export async function processBrevoOutboxBatch(
  limit = 10,
  supabase: BrevoAdminClient = getDefaultBrevoAdminClient()
): Promise<ProcessBatchResult> {
  const result: ProcessBatchResult = { claimed: 0, completed: 0, retried: 0, failed: 0, blocked: 0 };

  await reclaimStaleProcessingRows(supabase);

  const { data: claimedRows, error: claimError } = await supabase.rpc("claim_brevo_outbox_batch", {
    p_limit: limit,
  });

  if (claimError) {
    console.error("[brevo/outbox] claim failed:", claimError.message);
    return result;
  }

  const rows = (claimedRows ?? []) as OutboxRow[];
  result.claimed = rows.length;

  const systemicErrorClasses = new Set<BrevoErrorClass>();

  for (const row of rows) {
    const outcome = await processOutboxRow(row, supabase);
    result[outcome.status]++;
    if (outcome.status === "failed" && (outcome.errorClass === "config" || outcome.errorClass === "auth")) {
      systemicErrorClasses.add(outcome.errorClass);
    }
  }

  // A single systemic (config/auth) failure almost always means every other
  // job in the batch failed identically — one alert per batch run, not one
  // per row, keeps this from becoming alert spam (Part 6 requirement).
  if (systemicErrorClasses.size > 0) {
    await sendSlackAlert({
      channel: "ops-critical",
      severity: "critical",
      title: "Brevo sync outbox: systemic failure",
      message: `${result.failed} job(s) failed this run, including ${[...systemicErrorClasses].join(
        ", "
      )} error(s) — likely a Brevo credentials/configuration problem, not a per-contact issue. Check BREVO_API_KEY and outbox rows with last_error_class in ('config','auth').`,
      metadata: {
        claimed: result.claimed,
        completed: result.completed,
        retried: result.retried,
        failed: result.failed,
        blocked: result.blocked,
      },
    });
  }

  return result;
}

type RowOutcome = { status: "completed" | "retried" | "failed" | "blocked"; errorClass?: BrevoErrorClass };

async function processOutboxRow(row: OutboxRow, supabase: BrevoAdminClient): Promise<RowOutcome> {
  try {
    if (row.operation !== "upsert_contact") {
      throw new Error(`Unsupported outbox operation: ${row.operation}`);
    }

    if (row.payload.subscribed === false) {
      // Removal is inherently single-list — never expected to carry more
      // than one entry (see OutboxPayload.listIds' doc comment). Guarded
      // rather than silently taking listIds[0] so a future bug producing a
      // multi-list unsubscribe payload fails loudly instead of silently
      // dropping a list.
      if (row.payload.listIds.length !== 1) {
        throw new Error(
          `subscribed:false outbox row must target exactly one list, got ${row.payload.listIds.length}`
        );
      }
      await removeBrevoContactFromList({
        email: row.payload.email,
        listId: row.payload.listIds[0],
      });
    } else {
      await upsertBrevoContact({
        email: row.payload.email,
        attributes: row.payload.attributes,
        listIds: row.payload.listIds,
      });
    }

    await supabase
      .from("brevo_sync_outbox")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        last_error: null,
        last_error_class: null,
      })
      .eq("id", row.id);

    console.log("[brevo/outbox] completed", {
      provider: "brevo",
      operation: row.operation,
      subscribed: row.payload.subscribed !== false,
      entityType: row.entity_type,
      entityId: row.entity_id,
      outboxId: row.id,
    });

    return { status: "completed" };
  } catch (err) {
    const { errorClass, message } = classifyThrown(err);
    return handleRowFailure(row, errorClass, message, supabase);
  }
}

async function handleRowFailure(
  row: OutboxRow,
  errorClass: BrevoErrorClass,
  message: string,
  supabase: BrevoAdminClient
): Promise<RowOutcome> {
  const nextAttemptCount = row.attempt_count + 1;

  const logContext = {
    provider: "brevo",
    operation: row.operation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    outboxId: row.id,
    attempt: nextAttemptCount,
    errorClass,
    email: maskEmail(row.payload.email),
  };

  if (errorClass === "blocked") {
    console.warn("[brevo/outbox] blocked by staging allowlist", logContext);
    await supabase
      .from("brevo_sync_outbox")
      .update({
        status: "blocked",
        attempt_count: nextAttemptCount,
        last_error: message,
        last_error_class: errorClass,
      })
      .eq("id", row.id);
    return { status: "blocked", errorClass };
  }

  const retryable = isRetryable(errorClass) && nextAttemptCount < row.max_attempts;

  if (retryable) {
    const nextAttemptAt = new Date(Date.now() + computeBackoffMs(nextAttemptCount)).toISOString();
    console.warn("[brevo/outbox] transient failure — will retry", logContext);
    await supabase
      .from("brevo_sync_outbox")
      .update({
        status: "pending",
        attempt_count: nextAttemptCount,
        next_attempt_at: nextAttemptAt,
        last_error: message,
        last_error_class: errorClass,
      })
      .eq("id", row.id);
    return { status: "retried", errorClass };
  }

  console.error("[brevo/outbox] permanent failure — exhausted retries or non-transient error", logContext);
  await supabase
    .from("brevo_sync_outbox")
    .update({
      status: "failed",
      attempt_count: nextAttemptCount,
      last_error: message,
      last_error_class: errorClass,
    })
    .eq("id", row.id);
  return { status: "failed", errorClass };
}
