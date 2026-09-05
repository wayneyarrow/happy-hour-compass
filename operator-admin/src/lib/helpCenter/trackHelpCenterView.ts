"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Phase 4C — first-party Operator Admin Help Center usage tracking.
 * See supabase/migrations/090_help_center_view_events.sql for the table.
 * The landing-page sentinel slug lives in ./constants.ts (a "use server"
 * file may only export async functions, so it can't live here too).
 */

/**
 * Records one Help Center view — called from HelpViewTracker.tsx (a Client
 * Component mounted on the Help Center landing page, each How-To article
 * page, and the Getting Started guide) once per settled page load.
 *
 * View semantics: one article/landing-page load by an authenticated,
 * non-impersonated operator. Deduplication of same-mount React rerenders is
 * the caller's job (HelpViewTracker's one-shot mount ref) — this function
 * itself always writes exactly one row per call, no session-level dedup. A
 * genuine revisit later (a fresh mount — new page load, tab reopen, etc.)
 * is expected to count as another view; no artificial cooldown is applied.
 *
 * Operator/venue identity is resolved here, server-side, via the same
 * resolveOperatorContext() every other Operator Admin page/action already
 * uses — the caller never supplies (and this function never trusts) a
 * client-asserted operator or venue id. `articleSlug` is the one
 * caller-supplied value; it identifies content, not identity, so trusting
 * it from the client is no different from trusting a route param.
 *
 * Deliberately skips writing a row (rather than writing one with a null
 * operator_id) when:
 *   - No operator resolves at all (session expired mid-request, or the rare
 *     ensureOperatorForSession failure) — nothing genuine to attribute.
 *   - The request is a Founder/CP-admin impersonation session — a founder
 *     browsing Help Center *as* an operator during a support session is not
 *     that operator's own engagement, and attributing it to them would
 *     corrupt "which operators use the Help Center" reporting. This is a
 *     deliberate product decision, not an oversight — flagged for review if
 *     impersonation-driven support activity is ever separately of interest.
 *
 * Never throws: tracking must never block Help Center access. Every error
 * (resolution failure, insert failure) is swallowed after being resolved —
 * the caller (a fire-and-forget effect) doesn't await anything meaningful
 * back regardless.
 */
export async function recordHelpCenterView(articleSlug: string): Promise<void> {
  try {
    const ctx = await resolveOperatorContext();
    if (!ctx.operator || ctx.isImpersonating) return;

    const adminClient = createAdminClient();
    await adminClient.from("help_center_view_events").insert({
      article_slug: articleSlug,
      operator_id: ctx.operator.id,
      venue_id: ctx.activeVenueId,
    });
  } catch {
    // Intentionally swallowed — see doc comment above.
  }
}
