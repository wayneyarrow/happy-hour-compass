/**
 * Real dependencies for recordOperatorSignIn() (recordOperatorSignInImpl.ts).
 * Server-only — uses the session client for identity and the admin client
 * for venue_notes / operator_login_slack_notifications (both service-role
 * only, migration 106).
 */

import { after } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { sendSlackAcquisitionNotification, sendSlackAlert } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { SYSTEM_AUTHOR_EMAIL } from "@/lib/activation/activationNotes";
import type { LoginVenue, OperatorSignInDeps, ResolvedOperator, VerifiedSession } from "./recordOperatorSignInImpl";

const UNIQUE_VIOLATION = "23505";
const SLACK_TABLE = "operator_login_slack_notifications";

async function getVerifiedSession(): Promise<VerifiedSession | null> {
  const supabase = await createClient();
  // getUser() asks Supabase Auth to validate the session; getClaims() verifies
  // the access token's signature and returns session_id / amr.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user?.email) return null;

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    console.error("[operatorLogin] getClaims failed:", claimsError?.message ?? "no claims");
    return null;
  }
  if (claimsData.claims.sub !== user.id) return null;

  return { userId: user.id, email: user.email, claims: claimsData.claims };
}

function joinName(first: string | null, last: string | null, fallback: string | null): string | null {
  const full = [first, last].map((p) => p?.trim()).filter(Boolean).join(" ");
  return full || fallback?.trim() || null;
}

/**
 * Same precedence as Operator Admin's own context (buildNormalContext in
 * src/lib/impersonation.ts): an active team-member membership wins, else the
 * person's own operator account. Read-only — unlike buildNormalContext it
 * never relinks a membership or creates an operators row, so a consumer
 * session can't cause any write here.
 */
async function resolveOperator(session: { userId: string; email: string }): Promise<ResolvedOperator | null> {
  const supabase = createAdminClient();

  for (const [column, value] of [
    ["auth_user_id", session.userId],
    ["email", session.email],
  ] as const) {
    const { data: rows } = await supabase
      .from("operator_memberships")
      .select("operator_id, full_name")
      .eq(column, value)
      .eq("status", "active")
      .eq("role", "member")
      .order("accepted_at", { ascending: false })
      .limit(1);
    const member = rows?.[0] as { operator_id: string; full_name: string | null } | undefined;
    if (member) {
      const { data: op } = await supabase.from("operators").select("id").eq("id", member.operator_id).maybeSingle();
      if (op) return { operatorId: member.operator_id, name: member.full_name?.trim() || null };
    }
  }

  const { data: owner } = await supabase
    .from("operators")
    .select("id, first_name, last_name, name")
    .eq("email", session.email)
    .maybeSingle();
  if (!owner) return null;
  const row = owner as { id: string; first_name: string | null; last_name: string | null; name: string | null };
  return { operatorId: row.id, name: joinName(row.first_name, row.last_name, row.name) };
}

/** Same ownership column Operator Admin lists venues by (getOperatorVenues). */
async function listOperatorVenues(operatorId: string): Promise<LoginVenue[] | null> {
  const { data, error } = await createAdminClient()
    .from("venues")
    .select("id, name")
    .eq("created_by_operator_id", operatorId)
    .order("name", { ascending: true });
  if (error) {
    console.error("[operatorLogin] venue lookup failed:", error.message);
    return null;
  }
  return (data ?? []) as LoginVenue[];
}

export function createOperatorSignInDeps(): OperatorSignInDeps {
  return {
    now: () => new Date(),
    getVerifiedSession,
    resolveOperator,
    listOperatorVenues,

    async insertLoginNote({ venueId, note, eventKey, createdAt }) {
      const { error } = await createAdminClient().from("venue_notes").insert({
        venue_id: venueId,
        note,
        event_key: eventKey,
        created_at: createdAt,
        created_by_email: SYSTEM_AUTHOR_EMAIL,
      });
      if (!error) return "inserted";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      console.error("[operatorLogin] note insert failed:", error.message);
      return "error";
    },

    async claimSlackDay({ authUserId, loginDate, operatorId, claimedAt, staleBefore }) {
      const supabase = createAdminClient();
      const { error } = await supabase.from(SLACK_TABLE).insert({
        auth_user_id: authUserId,
        login_date: loginDate,
        operator_id: operatorId,
        claimed_at: claimedAt,
      });
      if (!error) return "claimed";
      if (error.code !== UNIQUE_VIOLATION) {
        console.error("[operatorLogin] Slack claim insert failed:", error.message);
        return "error";
      }

      // Row exists. Take it over only if nothing was sent and the previous
      // holder released it after a failure or died mid-send.
      const { data: existing, error: readError } = await supabase
        .from(SLACK_TABLE)
        .select("claimed_at, sent_at, attempt_count")
        .eq("auth_user_id", authUserId)
        .eq("login_date", loginDate)
        .maybeSingle();
      if (readError || !existing) return readError ? "error" : "taken";
      const row = existing as { claimed_at: string | null; sent_at: string | null; attempt_count: number };
      if (row.sent_at) return "taken";
      if (row.claimed_at && new Date(row.claimed_at).getTime() >= new Date(staleBefore).getTime()) return "taken";

      let takeover = supabase
        .from(SLACK_TABLE)
        .update({ claimed_at: claimedAt, attempt_count: row.attempt_count + 1 })
        .eq("auth_user_id", authUserId)
        .eq("login_date", loginDate)
        .is("sent_at", null);
      takeover = row.claimed_at ? takeover.eq("claimed_at", row.claimed_at) : takeover.is("claimed_at", null);
      const { data: won, error: takeoverError } = await takeover.select("auth_user_id");
      if (takeoverError) {
        console.error("[operatorLogin] Slack claim takeover failed:", takeoverError.message);
        return "error";
      }
      return won && won.length === 1 ? "claimed" : "taken";
    },

    async markSlackSent({ authUserId, loginDate, claimedAt, sentAt }) {
      const { data, error } = await createAdminClient()
        .from(SLACK_TABLE)
        .update({ sent_at: sentAt, last_error: null })
        .eq("auth_user_id", authUserId)
        .eq("login_date", loginDate)
        .eq("claimed_at", claimedAt)
        .select("auth_user_id");
      if (error) console.error("[operatorLogin] mark sent failed:", error.message);
      return !error && !!data && data.length === 1;
    },

    async releaseSlackClaim({ authUserId, loginDate, claimedAt, error: lastError }) {
      const { data, error } = await createAdminClient()
        .from(SLACK_TABLE)
        .update({ claimed_at: null, last_error: lastError })
        .eq("auth_user_id", authUserId)
        .eq("login_date", loginDate)
        .eq("claimed_at", claimedAt)
        .is("sent_at", null)
        .select("auth_user_id");
      if (error) console.error("[operatorLogin] release claim failed:", error.message);
      return !error && !!data && data.length === 1;
    },

    sendSlack: (text) => sendSlackAcquisitionNotification({ channel: "customer-success", text }),

    defer: (task) => after(task),

    async reportFailure(title, metadata) {
      console.error(`[operatorLogin] ${title}`, metadata);
      await sendSlackAlert({
        channel: "ops-alerts",
        severity: "warning",
        title,
        message: "The operator's sign-in itself succeeded; only the login notification/timeline step was affected.",
        metadata,
      });
    },

    siteUrl: getSiteUrl,
  };
}
