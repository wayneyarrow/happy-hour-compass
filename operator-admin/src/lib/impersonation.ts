/**
 * Impersonation library — Control Panel → Operator Admin support sessions.
 *
 * All functions in this file are server-side only (uses next/headers and
 * the service-role admin client). Never import from Client Components.
 *
 * Session lifecycle:
 *   1. POST /api/impersonate/start  → creates DB row, sets httpOnly cookie
 *   2. Each /admin/* request calls resolveOperatorContext() which reads the
 *      cookie and validates the session via the admin client.
 *   3. EXIT action clears the cookie and stamps ended_at on the DB row.
 *
 * Two impersonation modes:
 *   Case A — session.operator_id is set: acts as that operator (owned venue)
 *   Case B — session.operator_id is null: founder/support mode (orphan venue)
 */

import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession, OPERATOR_SELECT, type OperatorRow } from "@/lib/ensureOperator";
import {
  getActiveMembershipForAuthUser,
  getActiveMemberMembershipByEmail,
} from "@/lib/memberships";
import { getOperatorVenues, type VenueRow as VenueSummary } from "@/lib/getOperatorVenues";
import { getActiveVenueIdFromCookie } from "@/lib/activeVenueCookie";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const IMP_COOKIE_NAME = "imp_session_id";
export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── Types ─────────────────────────────────────────────────────────────────────

export type ImpersonationSession = {
  id: string;
  token: string;
  token_used_at: string | null;
  founder_email: string;
  founder_user_id: string | null;
  operator_id: string | null;
  venue_id: string;
  started_at: string;
  ended_at: string | null;
  expires_at: string;
  reason: string | null;
  created_at: string;
  // Resolved from FK joins
  venue_name: string | null;
  operator_email: string | null;
};

/**
 * The resolved operator context returned to pages and server actions.
 *
 * In normal mode:   supabase = session client, operator from JWT email.
 * In Case A imp:    supabase = admin client, operator from session.operator_id.
 * In Case B imp:    supabase = admin client, operator = null, impersonatingVenueId set.
 *
 * Multi-venue support (Phase 1, 2026-08-29): an operator may now legitimately
 * own more than one venue (see "Multi-venue ownership" note on
 * provisionOperatorForVenue, src/lib/operatorActivation.ts). `venues` and
 * `activeVenueId` are the single shared resolution of "which venues can this
 * request see, and which one is active right now" — every Operator Admin
 * page/action should read these rather than independently querying
 * `venues.created_by_operator_id` itself. See resolveVenuesAndActiveVenue().
 */
export type OperatorContext = {
  supabase: SupabaseClient;
  user: User | null;
  operator: OperatorRow | null;
  operatorError: string | null;
  isImpersonating: boolean;
  /** Set only in Case B (orphan venue, no operator). Use to scope DB queries. */
  impersonatingVenueId: string | null;
  /** Always set when impersonating (both Case A and B). */
  sessionVenueId: string | null;
  founderEmail: string | null;
  impersonationSessionId: string | null;
  /** For banner display */
  venueName: string | null;
  operatorEmail: string | null;
  /**
   * All venues owned by `operator` (normal mode and Case A impersonation),
   * or empty in Case B impersonation (no operator to own venues — use
   * `impersonatingVenueId` directly instead). Never trust a client-submitted
   * venue id against anything other than this list.
   */
  venues: VenueSummary[];
  /**
   * The single venue every read/write in this request should operate
   * against. Server-validated — always either a member of `venues`, or (in
   * impersonation) the venue the founder is impersonating. `null` means:
   * zero venues (nothing to show — existing empty-state handling applies),
   * or 2+ venues with no valid selection yet (caller must redirect to
   * /admin/select-venue — see assertActiveVenueSelected()).
   */
  activeVenueId: string | null;
};

/** OperatorContext before venues/activeVenueId are resolved — internal only. */
type OperatorContextBase = Omit<OperatorContext, "venues" | "activeVenueId">;

/**
 * Decides which venue(s) a request can act on and which one is active.
 * Centralizes every rule for "which venue(s) can this request act on":
 *
 *   - Case A impersonation (operator set): the founder already chose a
 *     specific venue to impersonate (session.venue_id) — that is always the
 *     active venue, regardless of how many venues the operator owns. No
 *     switcher is shown during impersonation.
 *   - Case B impersonation (orphan venue): no operator, so no owned-venue
 *     list — activeVenueId is the impersonated venue id directly.
 *   - Normal mode, 0 venues: activeVenueId is null — existing "no venue"
 *     empty-state handling in each page is unchanged.
 *   - Normal mode, 1 venue: that venue is automatically active — no
 *     selection screen, preserving the current single-venue experience.
 *   - Normal mode, 2+ venues: activeVenueId comes from the active-venue
 *     cookie ONLY if it matches one of the operator's actual owned venues —
 *     a forged/stale/foreign id is treated identically to "no selection".
 *
 * The actual decision (given venues + a candidate cookie value, which one is
 * active) is factored out into the pure computeActiveVenueId() below so it's
 * unit-testable without a database or cookie store.
 */

/**
 * Pure decision function — given who's asking and what venues they own,
 * decides which single venue (if any) is active. No I/O of its own, so it's
 * unit-testable without a database or cookie store (see
 * tests/unit/impersonation/computeActiveVenueId.test.ts) — every branch
 * documented on resolveVenuesAndActiveVenue() above is pinned there,
 * including that a cookie value not present in `venues` (forged, stale, or
 * belonging to a different operator entirely) is rejected exactly like no
 * selection at all.
 */
export function computeActiveVenueId({
  isImpersonating,
  hasOperator,
  sessionVenueId,
  impersonatingVenueId,
  venues,
  cookieVenueId,
}: {
  isImpersonating: boolean;
  hasOperator: boolean;
  sessionVenueId: string | null;
  impersonatingVenueId: string | null;
  venues: VenueSummary[];
  cookieVenueId: string | null;
}): string | null {
  if (isImpersonating) {
    return hasOperator ? sessionVenueId : impersonatingVenueId;
  }
  if (!hasOperator) {
    return null;
  }
  if (venues.length === 1) {
    return venues[0].id;
  }
  if (venues.length > 1) {
    const isOwned = !!cookieVenueId && venues.some((v) => v.id === cookieVenueId);
    return isOwned ? cookieVenueId! : null;
  }
  return null;
}

async function resolveVenuesAndActiveVenue(
  base: Pick<OperatorContextBase, "supabase" | "operator" | "isImpersonating" | "impersonatingVenueId" | "sessionVenueId">
): Promise<{ venues: VenueSummary[]; activeVenueId: string | null }> {
  const venues = base.operator
    ? (await getOperatorVenues(base.supabase, base.operator.id)).venues
    : [];

  const cookieVenueId =
    base.isImpersonating || !base.operator ? null : await getActiveVenueIdFromCookie();

  const activeVenueId = computeActiveVenueId({
    isImpersonating: base.isImpersonating,
    hasOperator: !!base.operator,
    sessionVenueId: base.sessionVenueId,
    impersonatingVenueId: base.impersonatingVenueId,
    venues,
    cookieVenueId,
  });

  return { venues, activeVenueId };
}

// ── Session creation ──────────────────────────────────────────────────────────

export async function createImpersonationSession({
  founderEmail,
  founderUserId,
  venueId,
  operatorId,
}: {
  founderEmail: string;
  founderUserId: string;
  venueId: string;
  operatorId: string | null;
}): Promise<{ sessionId?: string; error?: string }> {
  const token = randomBytes(32).toString("hex"); // reserved for future URL flows
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("operator_impersonation_sessions")
    .insert({
      token,
      founder_email: founderEmail,
      founder_user_id: founderUserId,
      operator_id: operatorId,
      venue_id: venueId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[impersonation] createImpersonationSession failed:", error);
    return { error: "Failed to create impersonation session." };
  }

  return { sessionId: (data as { id: string }).id };
}

// ── Per-request session validation ────────────────────────────────────────────

export async function getValidImpersonationSession(
  sessionId: string
): Promise<ImpersonationSession | null> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("operator_impersonation_sessions")
    .select(
      `id, token, token_used_at, founder_email, founder_user_id,
       operator_id, venue_id, started_at, ended_at, expires_at, reason, created_at,
       venues!venue_id ( name ),
       operators!operator_id ( email )`
    )
    .eq("id", sessionId)
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as Record<string, any>;
  const venueRow = row.venues as { name: string } | null;
  const operatorRow = row.operators as { email: string } | null;

  return {
    id: row.id,
    token: row.token,
    token_used_at: row.token_used_at,
    founder_email: row.founder_email,
    founder_user_id: row.founder_user_id,
    operator_id: row.operator_id,
    venue_id: row.venue_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    expires_at: row.expires_at,
    reason: row.reason,
    created_at: row.created_at,
    venue_name: venueRow?.name ?? null,
    operator_email: operatorRow?.email ?? null,
  };
}

// ── End a session ─────────────────────────────────────────────────────────────

export async function endImpersonationSession(sessionId: string): Promise<void> {
  const adminClient = createAdminClient();
  await adminClient
    .from("operator_impersonation_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId);
}

// ── Centralized operator context resolver ─────────────────────────────────────
//
// Call this from admin pages and server actions instead of the private
// resolveOperator() pattern. Returns one of:
//   • Normal context  — derived from the logged-in user's JWT session
//   • Case A context  — impersonated operator (admin client + operator from DB)
//   • Case B context  — orphan venue (admin client, operator = null)

export async function resolveOperatorContext(): Promise<OperatorContext> {
  const base = await resolveOperatorContextBase();
  const { venues, activeVenueId } = await resolveVenuesAndActiveVenue(base);
  return { ...base, venues, activeVenueId };
}

async function resolveOperatorContextBase(): Promise<OperatorContextBase> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(IMP_COOKIE_NAME)?.value;

  if (sessionId) {
    const session = await getValidImpersonationSession(sessionId);

    if (!session) {
      // Cookie present but session expired/ended — fall back to normal.
      // The layout will clear the banner; the action will get normal context.
      return buildNormalContext();
    }

    const adminClient = createAdminClient();
    let operator: OperatorRow | null = null;

    if (session.operator_id) {
      // Case A: fetch the impersonated operator by ID using admin client.
      const { data } = await adminClient
        .from("operators")
        .select(OPERATOR_SELECT)
        .eq("id", session.operator_id)
        .maybeSingle();
      operator = data as unknown as OperatorRow | null;
    }
    // Case B: operator_id is null — operator stays null, impersonatingVenueId is set.

    return {
      supabase: adminClient,
      user: null,
      operator,
      operatorError: null,
      isImpersonating: true,
      impersonatingVenueId: session.operator_id ? null : session.venue_id,
      sessionVenueId: session.venue_id,
      founderEmail: session.founder_email,
      impersonationSessionId: session.id,
      venueName: session.venue_name,
      operatorEmail: session.operator_email,
    };
  }

  return buildNormalContext();
}

// ── Internal: build normal (non-impersonation) context ───────────────────────

async function buildNormalContext(): Promise<OperatorContextBase> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      user: null,
      operator: null,
      operatorError: "Session expired. Please sign in again.",
      isImpersonating: false,
      impersonatingVenueId: null,
      sessionVenueId: null,
      founderEmail: null,
      impersonationSessionId: null,
      venueName: null,
      operatorEmail: null,
    };
  }

  // ── Context resolution: member membership takes priority in V1 ───────────────
  //
  // Resolution order (confirmed by DB investigation 2026-06-05):
  //
  //   Step 1 — Fast path member: if auth_user_id is already correctly linked
  //     on a member membership, return the invited operator immediately.
  //     This is the hot path after the first login corrects the link.
  //
  //   Step 2 — Email-based member check: finds active member memberships by
  //     email, regardless of auth_user_id state. Runs whenever Step 1 didn't
  //     return a member membership — including when the fast path returned an
  //     OWNER membership. Member context always wins over owner in V1.
  //     Corrects auth_user_id as a side effect so Step 1 handles all future
  //     logins without this overhead.
  //
  //   Step 3 — Owner context: used only when no member membership exists at all.
  //     Reads the operator from the fast-path owner membership (auth_user_id
  //     matched). For trigger-created memberships (auth_user_id=null), falls
  //     through to ensureOperatorForSession.
  //
  //   Step 4 — ensureOperatorForSession: final fallback for new operators whose
  //     owner membership has auth_user_id=null (trigger-created, not backfilled).
  //
  // Root cause for multi-membership users: when a user is both an owner on
  // operator A AND an invited member on operator B, the old code committed to
  // the owner context (fast path) before ever running the email member check.
  // The member membership had auth_user_id=null so it was invisible to the
  // auth_user_id query. This fix separates the two decisions.

  const membership = await getActiveMembershipForAuthUser(user.id);

  // ── Step 1: Fast path — confirmed member membership ───────────────────────
  // Uses adminClient for ctx.supabase — the same pattern as impersonation.
  // Rationale: venue/event/media RLS policies check operators.email = jwt.email.
  // A member's JWT email maps to their own personal operator, not the operator
  // they were invited to manage. The session client would therefore be blocked
  // by RLS for all venue operations on the invited operator's data. Using the
  // admin client bypasses RLS; application-level filters (created_by_operator_id
  // in buildVenueUpdate, venue_id in image/event queries) enforce the correct
  // authorization boundary — exactly as impersonation already does.
  if (membership?.role === "member") {
    const adminClient = createAdminClient();
    const { data: operatorData, error: operatorLoadError } = await adminClient
      .from("operators")
      .select(OPERATOR_SELECT)
      .eq("id", membership.operator_id)
      .maybeSingle();

    if (operatorData) {
      return {
        supabase: adminClient,   // admin client — bypasses email-based RLS for members
        user,
        operator: operatorData as unknown as OperatorRow,
        operatorError: null,
        isImpersonating: false,
        impersonatingVenueId: null,
        sessionVenueId: null,
        founderEmail: null,
        impersonationSessionId: null,
        venueName: null,
        operatorEmail: null,
      };
    }

    console.warn(
      "[buildNormalContext] Member membership (fast path) points to missing operator:",
      membership.operator_id,
      operatorLoadError?.message ?? "(no error)"
    );
  }

  // ── Step 2: Email-based member check — member takes priority over owner ────
  // Runs when:
  //   A) Fast path returned null (auth_user_id not yet linked on member row).
  //   B) Fast path returned an owner membership (member row invisible due to
  //      null/stale auth_user_id, but member context must still take priority).
  // Corrects auth_user_id on the membership row so Step 1 handles future logins.
  // Uses adminClient for the same reason as Step 1.
  if (user.email) {
    const memberMembership = await getActiveMemberMembershipByEmail(user.email);

    if (memberMembership) {
      const adminClient = createAdminClient();

      if (memberMembership.auth_user_id !== user.id) {
        const { error: relinkError } = await adminClient
          .from("operator_memberships")
          .update({ auth_user_id: user.id })
          .eq("id",    memberMembership.id)
          .eq("email", user.email);
        if (relinkError) {
          console.error("[buildNormalContext] auth_user_id relink failed:", relinkError.message);
        }
      }

      const { data: operatorData, error: opError } = await adminClient
        .from("operators")
        .select(OPERATOR_SELECT)
        .eq("id", memberMembership.operator_id)
        .maybeSingle();

      if (operatorData) {
        return {
          supabase: adminClient,   // admin client — bypasses email-based RLS for members
          user,
          operator: operatorData as unknown as OperatorRow,
          operatorError: null,
          isImpersonating: false,
          impersonatingVenueId: null,
          sessionVenueId: null,
          founderEmail: null,
          impersonationSessionId: null,
          venueName: null,
          operatorEmail: null,
        };
      }

      console.warn(
        "[buildNormalContext] Member membership (email fallback) points to missing operator:",
        memberMembership.operator_id,
        opError?.message ?? "(no error)"
      );
    }
  }

  // ── Step 3: Owner context — no member membership exists ──────────────────
  if (membership?.role === "owner") {
    const adminClient = createAdminClient();
    const { data: operatorData, error: operatorLoadError } = await adminClient
      .from("operators")
      .select(OPERATOR_SELECT)
      .eq("id", membership.operator_id)
      .maybeSingle();

    if (operatorData) {
      return {
        supabase,
        user,
        operator: operatorData as unknown as OperatorRow,
        operatorError: null,
        isImpersonating: false,
        impersonatingVenueId: null,
        sessionVenueId: null,
        founderEmail: null,
        impersonationSessionId: null,
        venueName: null,
        operatorEmail: null,
      };
    }

    console.warn(
      "[buildNormalContext] Owner membership points to missing operator:",
      membership.operator_id,
      operatorLoadError?.message ?? "(no error)"
    );
  }

  // ── Final fallback: existing operator resolution ──────────────────────────
  // Used for:
  //   - New operators whose owner membership has auth_user_id = null (trigger-created).
  //   - Operators with no membership at all (unusual but handled gracefully).
  //   - Recovery when operator record is unexpectedly missing above.
  const { operator, error: operatorError } = await ensureOperatorForSession(supabase, user);

  return {
    supabase,
    user,
    operator,
    operatorError: operatorError ?? null,
    isImpersonating: false,
    impersonatingVenueId: null,
    sessionVenueId: null,
    founderEmail: null,
    impersonationSessionId: null,
    venueName: null,
    operatorEmail: null,
  };
}

// ── Multi-venue gate ──────────────────────────────────────────────────────────

/**
 * Call once at the top of every venue-scoped Operator Admin page (dashboard,
 * venue info, happy hours, events, images, analytics, subscription, users,
 * etc.) immediately after `resolveOperatorContext()`.
 *
 * Redirects to /admin/select-venue when the operator owns 2+ venues and none
 * is currently active (no cookie, or the cookie didn't match an owned venue).
 * A no-op in every other case:
 *   - impersonating (activeVenueId is already fixed by the session), or
 *   - 0 venues (existing empty-state handling in the page itself applies), or
 *   - 1 venue (auto-selected), or
 *   - 2+ venues with a valid selection already active.
 *
 * The select-venue page and its selection server action must NOT call this
 * (it would redirect to itself) — they call resolveOperatorContext() and
 * getOperatorVenues()-derived data directly instead.
 */
export function assertActiveVenueSelected(ctx: OperatorContext): void {
  if (ctx.isImpersonating) return;
  if (ctx.operator && ctx.venues.length > 1 && !ctx.activeVenueId) {
    redirect("/admin/select-venue");
  }
}
