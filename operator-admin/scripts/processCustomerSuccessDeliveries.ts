/**
 * scripts/processCustomerSuccessDeliveries.ts
 *
 * Manual invocation of the Customer Success delivery processor (Phase
 * 1B — see src/lib/customerSuccess/processCustomerSuccessDeliveries.ts).
 * Not wired to any scheduler — the real automated path is
 * /api/cron/customer-success-deliveries (vercel.json).
 *
 * SAFETY MODEL — two independent gates, matching this repo's established
 * dry-run-before-apply convention (see CLAUDE.md, "Seeded Market Launch
 * Prep", and scripts/detectCustomerSuccessMilestones.ts):
 *   1. This script defaults to DRY RUN. Without --apply, it only runs
 *      detection/scheduling bookkeeping preview via a summary — it does
 *      NOT call processCustomerSuccessDeliveries() at all in dry-run mode,
 *      so there is no risk of it writing anything.
 *   2. Even with --apply, actually sending an email additionally requires
 *      CUSTOMER_SUCCESS_EMAILS_ENABLED=true in the environment — the same
 *      server-side kill switch the real cron route respects. --apply
 *      alone is NOT enough to send a real email.
 *
 * USAGE (from operator-admin/)
 *   npm run customer-success:process-deliveries -- --dry-run
 *   npm run customer-success:process-deliveries -- --apply
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { processCustomerSuccessDeliveries } from "../src/lib/customerSuccess/processCustomerSuccessDeliveries";
import { isCustomerSuccessEmailDeliveryEnabled } from "../src/lib/customerSuccess/customerSuccessConfig";

// ── Environment ────────────────────────────────────────────────────────────────

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── CLI args ─────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nCustomer Success — Delivery Processor (${APPLY ? "APPLY" : "DRY RUN"})\n`);
  console.log(`Kill switch (CUSTOMER_SUCCESS_EMAILS_ENABLED): ${isCustomerSuccessEmailDeliveryEnabled() ? "ON" : "off"}\n`);

  if (!APPLY) {
    console.log(
      "Dry run only — nothing was run. Re-run with --apply to run detection, scheduling, and (if the kill\n" +
        "switch is also ON) live delivery attempts.\n"
    );
    return;
  }

  const result = await processCustomerSuccessDeliveries(supabase);

  if (!result.enabled || !result.detection) {
    console.log(
      "Kill switch is OFF — the whole Customer Success run was a no-op (Correction Pass Section 1):\n" +
        "no detection, no baseline/event creation, no scheduling, no claiming, no Resend, no Slack.\n" +
        "Set CUSTOMER_SUCCESS_EMAILS_ENABLED=true to run for real.\n"
    );
    return;
  }

  console.log("Detection:");
  console.log(`  venuesEvaluated:             ${result.detection.venuesEvaluated}`);
  console.log(`  milestonesNewlyAchieved:     ${result.detection.milestonesNewlyAchieved}`);
  console.log(`  milestonesSuperseded:        ${result.detection.milestonesSuperseded}`);
  console.log(`  pendingMilestonesSuperseded: ${result.detection.pendingMilestonesSuperseded}`);

  console.log("\nDelivery:");
  console.log(`  enabled (kill switch):        ${result.enabled}`);
  console.log(`  staleRecovered:               ${result.staleRecovered}`);
  console.log(`  newlyScheduled:               ${result.newlyScheduled}`);
  console.log(`  timezoneBlocked:              ${result.timezoneBlocked}`);
  console.log(`  successNotificationsRetried:  ${result.successNotificationsRetried}`);
  console.log(`  attempted:                    ${result.attempted}`);
  console.log(`  sent:                         ${result.sent}`);
  console.log(`  retried:                      ${result.retried}`);
  console.log(`  failedTerminal:               ${result.failedTerminal}`);
  console.log(`  recipientBlocked:             ${result.recipientBlocked}`);
  console.log(`  errors:                       ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(`    event ${e.eventId}: ${e.message}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
