/**
 * scripts/processActivationReminders.ts
 *
 * Manual, DRY-RUN-ONLY preview of the operator-activation reminder/expiry
 * worker (Phase 2A-3 — see src/lib/activation/processActivationReminders.ts).
 * Not wired to any scheduler — the real automated path is
 * /api/cron/operator-activation-reminders (vercel.json).
 *
 * SAFETY MODEL — stricter than the Customer Success manual script
 * (scripts/processCustomerSuccessDeliveries.ts), by design: this script has
 * NO --apply flag and NO way to reach live mode, period. It always calls
 * planActivationReminders() — the dedicated read-only planning entry point,
 * a SEPARATE exported function from the live processActivationReminders()
 * (which this script never imports at all). planActivationReminders()
 * deliberately never checks the OPERATOR_ACTIVATION_REMINDERS_ENABLED kill
 * switch — this preview must keep working while that switch stays unset in
 * every environment, which is the normal, expected state today. Its safety
 * instead comes from every mutating Supabase call and every external call
 * (email, Slack) inside the orchestrator being permanently skipped in
 * planning mode. This is deliberately a READ-ONLY tool:
 *   - Requires the literal --dry-run flag; refuses to run at all without it.
 *   - No other flag exists that could enable a live send.
 *   - There is no code path from here into processActivationReminders() —
 *     not a flag, not an env var, nothing.
 *   - Prints only sanitized, already-decided outcomes (which lifecycle,
 *     which stage, the resolved recipient email) — never a setup link,
 *     token, or any environment variable's value.
 *
 * USAGE (from operator-admin/)
 *   npm run activation-reminders:dry-run -- --dry-run
 *
 * (The doubled "--dry-run" is intentional: npm passes flags after `--`
 * straight through to this script, and the flag itself is the safety gate
 * this script checks — there is no shorter/implicit form.)
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { planActivationReminders } from "../src/lib/activation/processActivationReminders";

// ── Mandatory safety gate — checked BEFORE touching env vars or Supabase ───

if (!process.argv.includes("--dry-run")) {
  console.error(
    "\nRefusing to run: this script is dry-run-only and requires the explicit --dry-run flag.\n" +
      "There is no other option that enables live mode — this tool can never send a real email or Slack message.\n\n" +
      "Usage: npm run activation-reminders:dry-run -- --dry-run\n"
  );
  process.exit(1);
}

// ── Environment ────────────────────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nOperator Activation Reminders — DRY RUN (read-only, zero writes, zero external calls)\n");

  const result = await planActivationReminders({ adminClient: supabase });

  // `enabled` is purely informational here — it reports the real, persistent
  // kill switch value, but this planning pass ran and read real data
  // regardless of it. The switch only ever gates the LIVE cron path.
  console.log(
    `Persistent kill switch (OPERATOR_ACTIVATION_REMINDERS_ENABLED): ${result.enabled ? "ON" : "OFF (expected — this preview works independent of it)"}\n`
  );

  console.log(`staleLeasesRecovered (dry-run never recovers):     ${result.staleLeasesRecovered}`);
  console.log(`lazilyInitialized:                                 ${result.lazilyInitialized}`);
  console.log(`expiryTransitioned:                                ${result.expiryTransitioned}`);
  console.log(`reminderAttempted:                                 ${result.reminderAttempted}`);
  console.log(`errors:                                            ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(`  lifecycle ${e.lifecycleId}: ${e.message}`);
  }

  console.log("\nPlanned actions (nothing was written; recipient emails are ordinary business data, never a secret):");
  if (result.plannedActions.length === 0) {
    console.log("  (none — nothing is currently due)");
  } else {
    for (const action of result.plannedActions) {
      console.log(`  ${JSON.stringify(action)}`);
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
