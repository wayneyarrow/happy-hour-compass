/**
 * Records an operator's Business Login sign-in: one "Operator logged in"
 * Internal Note per associated venue, plus at most one #customer-success
 * Slack message per person per America/Vancouver calendar day.
 *
 * No "use server" — the thin wrapper in src/app/login/actions.ts takes no
 * arguments and wires the real dependencies (operatorLoginStore.ts). Every
 * identity fact comes from the server-verified session: the client can't
 * name an operator, a venue or a sign-in.
 *
 * Duplicate prevention:
 *   - Notes: event_key hhc-operator-login:<session id>:<venue id> with a
 *     unique index (migration 106). A repeated call, retry or concurrent
 *     request for the same sign-in collides (23505) and is a no-op. A new
 *     sign-in gets a new session id, so it is always recorded.
 *   - Slack: an INSERT-wins claim on (auth user, Pacific date). Only the
 *     winner sends. sent_at is written only after Slack answered 2xx; a
 *     failed send releases the claim so a later sign-in that day can retry.
 *     There is no background retry — a day whose only sign-in hit a Slack
 *     failure stays unannounced (the notes still exist).
 *   - Known limits (at-least-once, never falsely "sent"): Slack may accept a
 *     message after our 4 s timeout, or the process may die between Slack's
 *     2xx and the sent_at write (the claim then goes stale after
 *     SLACK_CLAIM_STALE_MS). Either way a later sign-in that day may post a
 *     second message.
 *
 * Never throws. Nothing here can block a sign-in: the caller has already
 * authenticated, and the client ignores this action's outcome.
 */

import type { SlackResult } from "@/lib/slack";
import {
  buildLoginNoteEventKey,
  buildLoginNoteText,
  buildLoginSlackText,
  pacificLoginDate,
  resolvePasswordSignIn,
  SLACK_CLAIM_STALE_MS,
  type PasswordSignInRejection,
} from "./operatorLoginPolicy";

export type VerifiedSession = {
  userId: string;
  email: string;
  /** JWT claims verified by Supabase (signature + expiry). */
  claims: { session_id?: unknown; amr?: unknown };
};

export type ResolvedOperator = {
  operatorId: string;
  /** Display name of the person who signed in (owner or team member). */
  name: string | null;
};

export type LoginVenue = { id: string; name: string };

export type SlackDayKey = { authUserId: string; loginDate: string };

export type OperatorSignInDeps = {
  now(): Date;
  getVerifiedSession(): Promise<VerifiedSession | null>;
  resolveOperator(session: { userId: string; email: string }): Promise<ResolvedOperator | null>;
  /** Venues the operator's Admin context can manage; null on a read error. */
  listOperatorVenues(operatorId: string): Promise<LoginVenue[] | null>;
  insertLoginNote(row: {
    venueId: string;
    note: string;
    eventKey: string;
    createdAt: string;
  }): Promise<"inserted" | "duplicate" | "error">;
  claimSlackDay(params: SlackDayKey & {
    operatorId: string;
    claimedAt: string;
    staleBefore: string;
  }): Promise<"claimed" | "taken" | "error">;
  markSlackSent(params: SlackDayKey & { claimedAt: string; sentAt: string }): Promise<boolean>;
  releaseSlackClaim(params: SlackDayKey & { claimedAt: string; error: string }): Promise<boolean>;
  sendSlack(text: string): Promise<SlackResult>;
  /** Runs work after the response is sent (next/server after()). */
  defer(task: () => Promise<unknown>): void;
  reportFailure(title: string, metadata: Record<string, string | number>): Promise<void>;
  siteUrl(): string;
};

export type OperatorSignInResult =
  | {
      status: "skipped";
      reason:
        | "no_session"
        | PasswordSignInRejection
        | "not_operator"
        | "no_venues"
        | "venue_lookup_failed"
        | "unexpected_error";
    }
  | {
      status: "recorded";
      notes: { inserted: number; duplicate: number; failed: number };
      slack: "scheduled";
    };

export async function recordOperatorSignIn(deps: OperatorSignInDeps): Promise<OperatorSignInResult> {
  try {
    return await recordOperatorSignInUnsafe(deps);
  } catch (err) {
    await deps.reportFailure("Operator login recording failed unexpectedly", {
      Error: err instanceof Error ? err.message : String(err),
    });
    return { status: "skipped", reason: "unexpected_error" };
  }
}

async function recordOperatorSignInUnsafe(deps: OperatorSignInDeps): Promise<OperatorSignInResult> {
  const session = await deps.getVerifiedSession();
  if (!session) return { status: "skipped", reason: "no_session" };

  const resolved = resolvePasswordSignIn(session.claims, deps.now());
  if (!resolved.ok) return { status: "skipped", reason: resolved.reason };
  const { sessionId, signedInAt } = resolved.signIn;

  const operator = await deps.resolveOperator({ userId: session.userId, email: session.email });
  if (!operator) return { status: "skipped", reason: "not_operator" };

  const venues = await deps.listOperatorVenues(operator.operatorId);
  if (venues === null) {
    await deps.reportFailure("Operator login: venue lookup failed", { "Operator ID": operator.operatorId });
    return { status: "skipped", reason: "venue_lookup_failed" };
  }
  if (venues.length === 0) return { status: "skipped", reason: "no_venues" };

  // ── Timeline: one note per venue, keyed to this exact sign-in ─────────────
  const note = buildLoginNoteText({ operatorName: operator.name, email: session.email });
  const outcomes = await Promise.all(
    venues.map((venue) =>
      deps.insertLoginNote({
        venueId: venue.id,
        note,
        eventKey: buildLoginNoteEventKey(sessionId, venue.id),
        createdAt: signedInAt.toISOString(),
      })
    )
  );
  const notes = {
    inserted: outcomes.filter((o) => o === "inserted").length,
    duplicate: outcomes.filter((o) => o === "duplicate").length,
    failed: outcomes.filter((o) => o === "error").length,
  };
  if (notes.failed > 0) {
    await deps.reportFailure("Operator login: venue Internal Note failed to write", {
      "Operator ID": operator.operatorId,
      "Failed venues": notes.failed,
    });
  }

  // ── Slack: after the response, at most once per person per Pacific day ────
  deps.defer(() =>
    notifySlackOncePerDay(deps, {
      authUserId: session.userId,
      operatorId: operator.operatorId,
      operatorName: operator.name,
      email: session.email,
      venues,
      signedInAt,
    })
  );

  return { status: "recorded", notes, slack: "scheduled" };
}

export async function notifySlackOncePerDay(
  deps: OperatorSignInDeps,
  params: {
    authUserId: string;
    operatorId: string;
    operatorName: string | null;
    email: string;
    venues: LoginVenue[];
    signedInAt: Date;
  }
): Promise<"sent" | "suppressed" | "failed" | "no-webhook"> {
  try {
    // The day of the sign-in itself, not of whenever this deferred task runs.
    const key: SlackDayKey = {
      authUserId: params.authUserId,
      loginDate: pacificLoginDate(params.signedInAt),
    };
    const claimedAt = deps.now();
    const claim = await deps.claimSlackDay({
      ...key,
      operatorId: params.operatorId,
      claimedAt: claimedAt.toISOString(),
      staleBefore: new Date(claimedAt.getTime() - SLACK_CLAIM_STALE_MS).toISOString(),
    });
    if (claim === "taken") return "suppressed";
    if (claim === "error") {
      await deps.reportFailure("Operator login: Slack day claim failed", { "Operator ID": params.operatorId });
      return "failed";
    }

    const result = await deps.sendSlack(
      buildLoginSlackText({
        operatorName: params.operatorName,
        email: params.email,
        venues: params.venues,
        signedInAt: params.signedInAt,
        siteUrl: deps.siteUrl(),
      })
    );

    if (result === "delivered") {
      const marked = await deps.markSlackSent({
        ...key,
        claimedAt: claimedAt.toISOString(),
        sentAt: deps.now().toISOString(),
      });
      if (!marked) {
        await deps.reportFailure("Operator login: Slack sent but sent_at not recorded", {
          "Operator ID": params.operatorId,
          "Login date": key.loginDate,
        });
      }
      return "sent";
    }

    // "failed" or "no-webhook": never record as sent; free the day for a
    // later sign-in to try again.
    await deps.releaseSlackClaim({
      ...key,
      claimedAt: claimedAt.toISOString(),
      error: result === "no-webhook" ? "SLACK_CUSTOMER_SUCCESS_WEBHOOK_URL not set" : "Slack delivery failed",
    });
    if (result === "failed") {
      await deps.reportFailure("Operator login: #customer-success Slack delivery failed", {
        "Operator ID": params.operatorId,
        "Login date": key.loginDate,
      });
    }
    return result;
  } catch (err) {
    await deps.reportFailure("Operator login: Slack notification failed unexpectedly", {
      "Operator ID": params.operatorId,
      Error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}
