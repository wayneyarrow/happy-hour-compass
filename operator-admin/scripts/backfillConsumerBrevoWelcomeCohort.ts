/**
 * scripts/backfillConsumerBrevoWelcomeCohort.ts
 *
 * Thin CLI wrapper around src/lib/brevo/welcomeCohortBackfill.ts — see that
 * file for the actual selection/enqueue/cohort-marking logic and its
 * detailed doc comment. This file only handles environment loading, the
 * real Supabase client, argv parsing, and printing the report.
 *
 * Populates the one-time historical existing-consumer Brevo welcome cohort:
 * for every eligible consumer (src/lib/brevo/consumerEligibility.ts) not yet
 * marked as backfilled, enqueues ONE Brevo contact sync through the existing
 * durable outbox — targeting BOTH the ongoing BREVO_CONSUMER_LIST_ID and the
 * dedicated BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID in the same call — and
 * marks consumer_profiles.brevo_welcome_backfilled_at
 * (supabase/migrations/078_consumer_brevo_welcome_cohort.sql) only after
 * that single enqueue call has confirmed success. The historical list is a
 * campaign-targeting aid for Kate's one-time send in Brevo — it is never
 * HHC's source of truth for cohort membership; brevo_welcome_backfilled_at
 * remains that.
 *
 * This script:
 *   - NEVER calls the Brevo API directly — only enqueues into the existing
 *     durable outbox (brevo_sync_outbox). Actual delivery to Brevo happens
 *     later, via the existing scheduled outbox processor
 *     (src/app/api/cron/brevo-sync-outbox/route.ts).
 *   - NEVER sends a welcome email and NEVER activates any Brevo automation.
 *   - NEVER changes consumer marketing consent.
 *   - Is safe to re-run — see welcomeCohortBackfill.ts's doc comment.
 *   - Remains subject to the existing enqueue-time staging/production guard
 *     (isEnqueueAllowedInThisEnvironment) — a real --apply bulk run must
 *     execute somewhere VERCEL_ENV=production is true; running --apply from
 *     a local machine or a non-production deployment enqueues nothing, by
 *     design (fails closed).
 *   - Never runs automatically — requires an explicit `--apply` flag. No
 *     deployment, build, or schedule triggers it.
 *   - Refuses to run in --apply mode if either BREVO_CONSUMER_LIST_ID or
 *     BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID is missing/invalid — never
 *     silently enqueues to only one of the two lists (see
 *     resolveWelcomeCohortBackfillConfig() in welcomeCohortBackfill.ts).
 *
 * Dry-run is the default (matches the repo's existing script convention —
 * see scripts/refreshSeededVenues.ts).
 *
 * Run from the operator-admin directory:
 *   npm run backfill:consumer-brevo-welcome-cohort              ← dry-run (no writes)
 *   npm run backfill:consumer-brevo-welcome-cohort -- --apply   ← enqueues + marks cohort
 *
 * Prerequisites:
 *   - Migration 078_consumer_brevo_welcome_cohort.sql must be applied first.
 *   - BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID must be set to the ID of a
 *     dedicated Brevo list Wayne creates manually (e.g. "HHC Existing
 *     Consumer Welcome 2026") before any real --apply run — see
 *     src/lib/brevo/config.ts's getExistingConsumerWelcomeListId().
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  runConsumerBrevoWelcomeCohortBackfill,
  createSupabaseWelcomeCohortStore,
  resolveWelcomeCohortBackfillConfig,
  type WelcomeCohortBackfillSummary,
} from "../src/lib/brevo/welcomeCohortBackfill";
import type { ConsumerLookupClient } from "../src/lib/brevo/consumerEligibility";
import type { BrevoAdminClient } from "../src/lib/brevo/supabaseAdminClient";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    "ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.\n" +
      "       Make sure operator-admin/.env.local is populated."
  );
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Consumer Brevo Welcome Cohort Backfill (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  const { config, fatalError } = resolveWelcomeCohortBackfillConfig(APPLY);
  if (fatalError) {
    console.error("ERROR:", fatalError);
    process.exit(1);
  }
  if (!config) {
    console.warn(
      "WARNING: Brevo (or the historical welcome list) is not fully configured locally — continuing in dry-run mode with eligibility-only reporting."
    );
  }

  const summary = await runConsumerBrevoWelcomeCohortBackfill({
    apply: APPLY,
    store: createSupabaseWelcomeCohortStore(supabase),
    lookupClient: supabase as unknown as ConsumerLookupClient,
    outboxClient: supabase as unknown as BrevoAdminClient,
    config,
  });

  printReport(summary);
}

function printReport(summary: WelcomeCohortBackfillSummary) {
  console.log(`Mode:                                        ${summary.mode}`);
  console.log(`Already in historical cohort (prior runs):   ${summary.alreadyInHistoricalCohortBeforeThisRun}`);
  console.log(`Examined (candidates this run):              ${summary.examined}`);
  console.log(`Eligible:                                    ${summary.eligible}`);
  console.log(`Already represented in outbox (coalesced):   ${summary.alreadyRepresentedOrCoalesced}`);
  console.log(`Enqueued + cohort-marked this run:           ${summary.enqueued}`);
  console.log(`Excluded (ineligible):                       ${summary.excluded}`);
  for (const [reason, count] of Object.entries(summary.excludedByReason)) {
    console.log(`    - ${reason}: ${count}`);
  }
  console.log(`Errors:                                       ${summary.errors}`);
  for (const { consumerId, error } of summary.errorDetails) {
    console.log(`    - ${consumerId}: ${error}`);
  }
  if (summary.mode === "dry-run") {
    console.log(
      "\nDRY RUN — no rows were enqueued into brevo_sync_outbox and no consumer was marked as backfilled.\n" +
        "Re-run with --apply to perform the real backfill (subject to the enqueue-time staging guard above)."
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
