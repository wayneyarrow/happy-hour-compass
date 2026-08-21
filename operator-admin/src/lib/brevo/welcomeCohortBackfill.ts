import {
  evaluateConsumerBrevoEligibility,
  type ConsumerLookupClient,
} from "./consumerEligibility";
import { enqueueBrevoContactSync, buildDedupeKey } from "./contactSync";
import { buildNameAttributes } from "./consumerSync";
import { isEnqueueAllowedInThisEnvironment } from "./stagingGuard";
import { getBrevoConfig, getExistingConsumerWelcomeListId, BrevoConfigError } from "./config";
import type { BrevoAdminClient } from "./supabaseAdminClient";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Core, dependency-injected logic for the one-time historical
 * existing-consumer Brevo welcome cohort backfill
 * (scripts/backfillConsumerBrevoWelcomeCohort.ts is the thin CLI wrapper
 * around this).
 *
 * Deliberately does NOT reuse syncConsumerBrevoEligibility() (the lifecycle
 * hook orchestrator in consumerSync.ts) — that function never reports
 * success/failure to its caller (by design: a signup or profile update must
 * never be blocked by a Brevo problem), which makes it unsafe for this
 * module's "only mark the cohort after a CONFIRMED successful enqueue"
 * requirement. This calls the same lower-level, result-returning primitives
 * that function is itself built from (evaluateConsumerBrevoEligibility,
 * enqueueBrevoContactSync, isEnqueueAllowedInThisEnvironment) directly.
 *
 * A consumer is marked as part of the historical cohort
 * (consumer_profiles.brevo_welcome_backfilled_at — see
 * supabase/migrations/078_consumer_brevo_welcome_cohort.sql) ONLY after a
 * confirmed successful enqueue into brevo_sync_outbox in the same pass.
 * Ineligible consumers, and consumers whose enqueue attempt failed, are
 * left unmarked so a future re-run can still pick them up.
 */

export type WelcomeCohortCandidate = {
  id: string;
  email: string | null;
  marketing_consent: boolean;
};

/**
 * Minimal storage surface this module needs beyond
 * evaluateConsumerBrevoEligibility()/enqueueBrevoContactSync() themselves —
 * narrowed so tests can supply a small in-memory fake, matching the pattern
 * already established for ConsumerLookupClient/BrevoAdminClient.
 */
export type WelcomeCohortStore = {
  /** Informational count only — consumers already in the cohort are never re-examined by fetchCandidates(). */
  countAlreadyInCohort(): Promise<{ count: number; error: string | null }>;
  /** consumer_profiles WHERE marketing_consent = true AND email IS NOT NULL AND brevo_welcome_backfilled_at IS NULL. */
  fetchCandidates(): Promise<{ candidates: WelcomeCohortCandidate[]; error: string | null }>;
  /** True if brevo_sync_outbox already has a pending/processing row for this dedupe key. Read-only — safe to call in dry-run mode too. */
  hasPendingOutboxRow(dedupeKey: string): Promise<{ exists: boolean; error: string | null }>;
  /** Atomic `UPDATE ... WHERE brevo_welcome_backfilled_at IS NULL` — returns marked:true only if this call actually set it (false = already set by a concurrent/prior run). */
  markBackfilled(consumerId: string): Promise<{ marked: boolean; error: string | null }>;
};

/**
 * Config this module needs to actually enqueue. Deliberately its own type,
 * not a reuse of BrevoConfig — see resolveWelcomeCohortBackfillConfig()
 * below. A non-null value here means BOTH getBrevoConfig() succeeded AND
 * getExistingConsumerWelcomeListId() succeeded — so the core loop never
 * needs to check the historical list ID for presence on its own; "config is
 * present" already means "safe to build a two-list enqueue payload."
 */
export type WelcomeCohortBackfillConfig = {
  consumerListId: number;
  existingConsumerWelcomeListId: number;
  testEmail: string | null;
};

/**
 * Resolves this backfill's Brevo configuration from the environment,
 * distinguishing "not configured, but that's fine for a dry-run preview"
 * from "not configured, and --apply must therefore refuse to run" —
 * requirement #4 (Part 7): missing historical-list configuration must fail
 * safely, never silently enqueue only to the main list while still marking
 * a consumer as historically backfilled.
 *
 * - apply=true and either piece of config is missing → fatalError is set
 *   (the caller must abort before doing any work); config is null.
 * - apply=false (dry run) and either piece is missing → fatalError is null
 *   (a dry run must still be able to report eligibility counts); config is
 *   null, so the core loop's enqueue-preview steps are skipped.
 * - Both pieces present → config is fully populated, fatalError is null,
 *   regardless of apply.
 */
export function resolveWelcomeCohortBackfillConfig(apply: boolean): {
  config: WelcomeCohortBackfillConfig | null;
  fatalError: string | null;
} {
  let consumerListId: number;
  let testEmail: string | null;
  try {
    const base = getBrevoConfig();
    consumerListId = base.consumerListId;
    testEmail = base.testEmail;
  } catch (err) {
    const message = err instanceof BrevoConfigError ? err.message : String(err);
    return {
      config: null,
      fatalError: apply ? `Brevo is not configured — cannot enqueue in --apply mode: ${message}` : null,
    };
  }

  let existingConsumerWelcomeListId: number;
  try {
    existingConsumerWelcomeListId = getExistingConsumerWelcomeListId();
  } catch (err) {
    const message = err instanceof BrevoConfigError ? err.message : String(err);
    return {
      config: null,
      fatalError: apply
        ? `The historical welcome list is not configured — cannot enqueue in --apply mode: ${message}`
        : null,
    };
  }

  return { config: { consumerListId, existingConsumerWelcomeListId, testEmail }, fatalError: null };
}

export type WelcomeCohortBackfillSummary = {
  mode: "dry-run" | "apply";
  alreadyInHistoricalCohortBeforeThisRun: number;
  examined: number;
  eligible: number;
  alreadyRepresentedOrCoalesced: number;
  enqueued: number;
  excluded: number;
  excludedByReason: Record<string, number>;
  errors: number;
  errorDetails: { consumerId: string; error: string }[];
};

export async function runConsumerBrevoWelcomeCohortBackfill(options: {
  apply: boolean;
  store: WelcomeCohortStore;
  lookupClient: ConsumerLookupClient;
  outboxClient: BrevoAdminClient;
  /** null = Brevo (or the historical list) is not fully configured (e.g. local dry run) — eligibility is still fully reportable, enqueue-preview steps are skipped. Build via resolveWelcomeCohortBackfillConfig(). */
  config: WelcomeCohortBackfillConfig | null;
}): Promise<WelcomeCohortBackfillSummary> {
  const { apply, store, lookupClient, outboxClient, config } = options;

  const summary: WelcomeCohortBackfillSummary = {
    mode: apply ? "apply" : "dry-run",
    alreadyInHistoricalCohortBeforeThisRun: 0,
    examined: 0,
    eligible: 0,
    alreadyRepresentedOrCoalesced: 0,
    enqueued: 0,
    excluded: 0,
    excludedByReason: {},
    errors: 0,
    errorDetails: [],
  };

  const { count: alreadyCount, error: alreadyError } = await store.countAlreadyInCohort();
  if (alreadyError) {
    summary.errors++;
    summary.errorDetails.push({ consumerId: "(count query)", error: alreadyError });
    return summary;
  }
  summary.alreadyInHistoricalCohortBeforeThisRun = alreadyCount;

  const { candidates, error: candidatesError } = await store.fetchCandidates();
  if (candidatesError) {
    summary.errors++;
    summary.errorDetails.push({ consumerId: "(candidate query)", error: candidatesError });
    return summary;
  }
  summary.examined = candidates.length;

  for (const row of candidates) {
    let eligibility;
    try {
      eligibility = await evaluateConsumerBrevoEligibility(row.id, lookupClient);
    } catch (err) {
      summary.errors++;
      summary.errorDetails.push({ consumerId: row.id, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    if (!eligibility.eligible) {
      summary.excluded++;
      summary.excludedByReason[eligibility.reason] = (summary.excludedByReason[eligibility.reason] ?? 0) + 1;
      continue;
    }

    summary.eligible++;

    if (!config) continue; // dry run, Brevo unconfigured — eligibility-only reporting

    const dedupeKey = buildDedupeKey("consumer", row.id, "upsert_contact");
    const { exists: alreadyPending, error: pendingError } = await store.hasPendingOutboxRow(dedupeKey);
    if (pendingError) {
      summary.errors++;
      summary.errorDetails.push({ consumerId: row.id, error: pendingError });
      continue;
    }
    if (alreadyPending) summary.alreadyRepresentedOrCoalesced++;

    if (!apply) continue;

    if (!isEnqueueAllowedInThisEnvironment(eligibility.email, config.testEmail)) {
      continue; // blocked by the enqueue-time staging/production guard — never counted as an error
    }

    // The one enqueue call that differs from every ordinary lifecycle sync:
    // this contact is queued for BOTH the ongoing HHC consumer list AND the
    // dedicated one-time historical-welcome list, in the same durable
    // outbox row — Brevo's real /v3/contacts upsert already accepts
    // multiple listIds in one call (see client.ts), so this needs no second
    // outbox row, no second enqueue call, and no second sync architecture.
    // The cohort marker below is set only once THIS single call has
    // confirmed success, so "successfully recorded" always means "both list
    // memberships were durably queued together."
    const enqueueResult = await enqueueBrevoContactSync(
      {
        entityType: "consumer",
        entityId: row.id,
        email: eligibility.email,
        attributes: buildNameAttributes(eligibility.firstName, eligibility.lastName),
        listIds: [config.consumerListId, config.existingConsumerWelcomeListId],
        subscribed: true,
      },
      outboxClient
    );

    if (!enqueueResult.ok) {
      summary.errors++;
      summary.errorDetails.push({ consumerId: row.id, error: enqueueResult.error });
      continue;
    }

    summary.enqueued++;

    const { marked, error: markError } = await store.markBackfilled(row.id);
    if (markError || !marked) {
      summary.errors++;
      summary.errorDetails.push({
        consumerId: row.id,
        error: markError ?? "cohort marker update matched no row (already marked by a concurrent run)",
      });
    }
  }

  return summary;
}

/**
 * Real-Supabase adapter — the only place this module talks to Postgrest
 * directly. Used by the CLI script; tests supply an in-memory fake instead
 * (tests/unit/brevo/support/fakeWelcomeCohortStore.ts).
 */
export function createSupabaseWelcomeCohortStore(supabase: SupabaseClient): WelcomeCohortStore {
  return {
    async countAlreadyInCohort() {
      const { count, error } = await supabase
        .from("consumer_profiles")
        .select("id", { count: "exact", head: true })
        .not("brevo_welcome_backfilled_at", "is", null);
      return { count: count ?? 0, error: error?.message ?? null };
    },
    async fetchCandidates() {
      const { data, error } = await supabase
        .from("consumer_profiles")
        .select("id, email, marketing_consent")
        .eq("marketing_consent", true)
        .not("email", "is", null)
        .is("brevo_welcome_backfilled_at", null)
        .order("created_at", { ascending: true });
      return { candidates: (data ?? []) as WelcomeCohortCandidate[], error: error?.message ?? null };
    },
    async hasPendingOutboxRow(dedupeKey: string) {
      const { data, error } = await supabase
        .from("brevo_sync_outbox")
        .select("id")
        .eq("provider", "brevo")
        .eq("dedupe_key", dedupeKey)
        .in("status", ["pending", "processing"])
        .limit(1)
        .maybeSingle();
      return { exists: !!data, error: error?.message ?? null };
    },
    async markBackfilled(consumerId: string) {
      const { data, error } = await supabase
        .from("consumer_profiles")
        .update({ brevo_welcome_backfilled_at: new Date().toISOString() })
        .eq("id", consumerId)
        .is("brevo_welcome_backfilled_at", null)
        .select("id");
      return { marked: !error && !!data && data.length > 0, error: error?.message ?? null };
    },
  };
}
