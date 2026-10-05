/**
 * Operator login notifications — pure policy (no I/O).
 *
 * What counts as an operator sign-in: the Business Login form
 * (src/app/login/page.tsx) calls recordOperatorSignInAction() only after
 * signInWithPassword() succeeded AND the post-auth access check granted
 * Business access. The server never trusts that call by itself — it reads
 * the session's own verified JWT claims and requires:
 *
 *   - a `session_id` (Supabase creates a new auth session per sign-in and
 *     keeps it across token refreshes — so it identifies ONE sign-in), and
 *   - an `amr` entry with method "password" whose timestamp is recent.
 *
 * That excludes everything that isn't a fresh password sign-in: token
 * refreshes and restored sessions keep the original amr timestamp (stale →
 * rejected), and the setup / verification / password-reset flows authenticate
 * with otp/recovery, not "password". Activation forms that do sign in with a
 * password never call the action.
 */

import { CONTROL_PANEL_TIME_ZONE } from "@/lib/controlPanelDateTime";

/** A password sign-in older than this is not "the sign-in that just happened". */
export const SIGN_IN_FRESHNESS_MS = 10 * 60 * 1000;

/** Tolerated clock skew between Supabase Auth and the app server. */
export const SIGN_IN_FUTURE_SKEW_MS = 2 * 60 * 1000;

/**
 * A Slack claim older than this with no sent_at belongs to a request that
 * died mid-send (a send is bounded by Slack's 4 s timeout), so a later
 * sign-in the same day may take it over.
 */
export const SLACK_CLAIM_STALE_MS = 2 * 60 * 1000;

export type PasswordSignIn = { sessionId: string; signedInAt: Date };

export type PasswordSignInRejection =
  | "no_session_id"
  | "not_password_sign_in"
  | "stale_sign_in"
  | "future_sign_in";

/**
 * Validates verified JWT claims as a fresh password sign-in. Supports the
 * detailed amr format Supabase issues ([{ method, timestamp }]); the bare
 * RFC-8176 string format carries no timestamp, so it can't prove freshness
 * and is rejected.
 */
export function resolvePasswordSignIn(
  claims: { session_id?: unknown; amr?: unknown },
  now: Date
): { ok: true; signIn: PasswordSignIn } | { ok: false; reason: PasswordSignInRejection } {
  const sessionId = typeof claims.session_id === "string" ? claims.session_id.trim() : "";
  if (!sessionId) return { ok: false, reason: "no_session_id" };

  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  const passwordTimestamps = amr
    .filter(
      (entry): entry is { method: string; timestamp: number } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { method?: unknown }).method === "password" &&
        typeof (entry as { timestamp?: unknown }).timestamp === "number" &&
        Number.isFinite((entry as { timestamp: number }).timestamp)
    )
    .map((entry) => entry.timestamp * 1000);

  if (passwordTimestamps.length === 0) return { ok: false, reason: "not_password_sign_in" };

  const signedInMs = Math.max(...passwordTimestamps);
  const ageMs = now.getTime() - signedInMs;
  if (ageMs > SIGN_IN_FRESHNESS_MS) return { ok: false, reason: "stale_sign_in" };
  if (ageMs < -SIGN_IN_FUTURE_SKEW_MS) return { ok: false, reason: "future_sign_in" };

  return { ok: true, signIn: { sessionId, signedInAt: new Date(signedInMs) } };
}

/** "2026-10-05" — the America/Vancouver calendar day of an instant (DST-aware). */
export function pacificLoginDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONTROL_PANEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Oct 5, 2026, 7:54 AM PDT" — Pacific local time with its current abbreviation. */
export function formatPacificSignInTime(instant: Date): string {
  return instant.toLocaleString("en-US", {
    timeZone: CONTROL_PANEL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Deterministic per-sign-in, per-venue note key (venue_notes.event_key). */
export function buildLoginNoteEventKey(sessionId: string, venueId: string): string {
  return `hhc-operator-login:${sessionId}:${venueId}`;
}

export function formatOperatorIdentity(name: string | null, email: string): string {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} (${email})` : email;
}

export function buildLoginNoteText(params: { operatorName: string | null; email: string }): string {
  return `Operator logged in — ${formatOperatorIdentity(params.operatorName, params.email)}`;
}

/** Slack mrkdwn control characters; venue/operator names are user-entered. */
function escapeSlack(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildLoginSlackText(params: {
  operatorName: string | null;
  email: string;
  venues: { id: string; name: string }[];
  signedInAt: Date;
  siteUrl: string;
}): string {
  const lines = [
    `🔑 *Operator logged in*`,
    `*Operator:* ${escapeSlack(formatOperatorIdentity(params.operatorName, params.email))}`,
    `*Venue(s):* ${params.venues.map((v) => escapeSlack(v.name)).join(", ")}`,
    `*Signed in:* ${formatPacificSignInTime(params.signedInAt)}`,
  ];
  for (const venue of params.venues) {
    lines.push(`<${params.siteUrl}/control-panel/venues/${venue.id}|${escapeSlack(venue.name)} — Control Panel>`);
  }
  return lines.join("\n");
}
