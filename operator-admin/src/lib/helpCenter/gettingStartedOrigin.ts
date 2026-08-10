/**
 * Getting Started origin detection.
 *
 * The Getting Started guide must vary depending on whether the operator's
 * venue came from:
 *   1. Claiming an existing seeded venue ("claimed_seed"), or
 *   2. An approved new-venue submission ("approved_submission").
 *
 * STATE USED — and why it's the reliable one:
 *
 *   `venues.source` (added by supabase/migrations/013_venue_source_attribution.sql)
 *   is the origin-attribution field the schema already carries for exactly
 *   this purpose: 'seed' | 'operator_submission' | 'consumer_suggestion' | 'internal'.
 *   It is set once at venue-row creation and is never rewritten by either
 *   provisioning flow, so it cleanly distinguishes the two cases this task
 *   asks about.
 *
 *   `venues.claimed_at` / `claimed_by` / `created_by_operator_id` were
 *   investigated first (they're what admin/home/page.tsx's `isClaimed` flag
 *   already reads) but do NOT reliably distinguish the two origins:
 *   `provisionOperatorForVenue()` (src/lib/operatorActivation.ts) sets all
 *   three identically for BOTH the approved-claim flow
 *   (control-panel/claims/[id]/actions.ts) and the approved-submission flow
 *   (control-panel/operator-submissions/[id]/actions.ts) — every provisioned
 *   operator ends up with a truthy claimed_at regardless of origin. See the
 *   completion summary for this task for the full trace and a note that
 *   admin/home/page.tsx's "Claimed venues ... Submitted venues ..." context
 *   message comment may itself be stale against this reality — worth a
 *   product/eng review, out of scope to change here.
 *
 * No new database field was introduced — `source` already exists and is
 * exactly fit for purpose.
 */
export type OperatorVenueOrigin = "claimed_seed" | "approved_submission" | "unknown";

export function resolveOperatorVenueOrigin(
  source: string | null | undefined
): OperatorVenueOrigin {
  if (source === "seed") return "claimed_seed";
  if (source === "operator_submission") return "approved_submission";
  // consumer_suggestion / internal / null / anything else: no Getting
  // Started variant is defined for these today — fall back to the
  // origin-neutral copy rather than guessing.
  return "unknown";
}
