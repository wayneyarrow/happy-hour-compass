/**
 * scripts/detectCustomerSuccessMilestones.ts
 *
 * Manual invocation of the Customer Success venue-view-milestone detector
 * (Phase 1A — see src/lib/customerSuccess/). This exists to demonstrate/
 * test the detection architecture; it is NOT wired to any scheduler or
 * cron route and must not be treated as one. Phase 1B decides how (and
 * whether) to invoke runVenueViewMilestoneDetection() automatically.
 *
 * Detection-only: this never sends an email, never touches Resend. It only
 * ever writes to customer_success_events / customer_success_baselines
 * (migration 093).
 *
 * SAFETY MODEL — matches this repo's established dry-run-before-apply
 * convention (see CLAUDE.md, "Seeded Market Launch Prep"):
 *   - Defaults to DRY RUN. Zero Supabase writes unless --apply is passed.
 *   - Dry run computes and prints the exact plan (computeVenueViewMilestoneDecisions())
 *     without calling applyVenueViewMilestoneDecisions().
 *
 * USAGE (from operator-admin/)
 *   npm run customer-success:detect-venue-view-milestones -- --dry-run
 *   npm run customer-success:detect-venue-view-milestones -- --apply
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  computeVenueViewMilestoneDecisions,
  applyVenueViewMilestoneDecisions,
} from "../src/lib/customerSuccess/detectVenueViewMilestones";

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
  console.log(`\nCustomer Success — Venue View Milestone Detection (${APPLY ? "APPLY" : "DRY RUN"})\n`);

  const plan = await computeVenueViewMilestoneDecisions(supabase);

  console.log(`Venues evaluated (eligible):     ${plan.venuesEvaluated}`);
  console.log(`Venues ignored (ineligible):      ${plan.venuesIgnoredIneligible}`);

  const activeEntries = plan.entries.filter(
    (e) =>
      e.decision.baselineNeeded ||
      e.decision.newlyPending !== null ||
      e.decision.newlySuperseded.length > 0 ||
      e.decision.pendingToSupersede.length > 0
  );

  if (activeEntries.length === 0) {
    console.log("\nNo new milestones, supersessions, or baselines to record this run.\n");
  } else {
    console.log(`\n${activeEntries.length} venue(s) with a proposed change:\n`);
    for (const entry of activeEntries) {
      const parts: string[] = [];
      if (entry.decision.baselineNeeded) parts.push("baseline");
      if (entry.decision.newlyPending !== null) parts.push(`pending=${entry.decision.newlyPending}`);
      if (entry.decision.newlySuperseded.length > 0) {
        parts.push(`superseded(new)=[${entry.decision.newlySuperseded.join(", ")}]`);
      }
      if (entry.decision.pendingToSupersede.length > 0) {
        parts.push(`superseded(demoted)=[${entry.decision.pendingToSupersede.join(", ")}]`);
      }
      console.log(`  venue ${entry.venue.id}  views=${entry.currentViews}  ${parts.join("  ")}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("Dry run only — no writes made. Re-run with --apply to record the above.\n");
    return;
  }

  const result = await applyVenueViewMilestoneDecisions(plan, supabase);

  console.log("Applied:");
  console.log(`  venuesBaselined:             ${result.venuesBaselined}`);
  console.log(`  milestonesNewlyAchieved:     ${result.milestonesNewlyAchieved}`);
  console.log(`  milestonesSuperseded:        ${result.milestonesSuperseded}`);
  console.log(`  pendingMilestonesSuperseded: ${result.pendingMilestonesSuperseded}`);
  console.log(`  errors:                      ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(`    venue ${e.venueId}: ${e.message}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
