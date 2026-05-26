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
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession, OPERATOR_SELECT, type OperatorRow } from "@/lib/ensureOperator";
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
};

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

async function buildNormalContext(): Promise<OperatorContext> {
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
