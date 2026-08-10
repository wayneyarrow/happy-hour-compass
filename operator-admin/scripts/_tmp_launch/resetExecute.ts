import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function listAllAuthUsers() {
  const users: { id: string; email: string | null }[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null })));
    if (data.users.length < 1000) break;
    page++;
  }
  return users;
}

async function main() {
  // ── 0. Recompute the plan live (idempotent, avoids staleness vs the dry run) ──
  const { data: operators } = await supabase.from("operators").select("id,email");
  const { data: consumers } = await supabase.from("consumer_profiles").select("id,email");
  const { data: admins } = await supabase.from("platform_admins").select("email");
  const authUsers = await listAllAuthUsers();

  const adminEmails = new Set((admins ?? []).map((a) => a.email.toLowerCase()));
  const operatorEmails = new Set((operators ?? []).map((o) => (o.email ?? "").toLowerCase()));
  const consumerIds = new Set((consumers ?? []).map((c) => c.id));

  const operatorAuthIdsToDelete = authUsers
    .filter((u) => operatorEmails.has((u.email ?? "").toLowerCase()) && !adminEmails.has((u.email ?? "").toLowerCase()))
    .map((u) => u.id);
  const consumerAuthIdsToDelete = authUsers.filter((u) => consumerIds.has(u.id)).map((u) => u.id);

  console.log(`Plan: ${operatorAuthIdsToDelete.length} operator auth.users, ${consumerAuthIdsToDelete.length} consumer auth.users to delete.`);
  console.log(`Preserving ${authUsers.length - operatorAuthIdsToDelete.length - consumerAuthIdsToDelete.length} auth.users (platform admins / unrelated).`);

  // ── 1. plan_change_events — FK is NOT NULL + no ON DELETE action; must clear before deleting operators ──
  {
    const { error, count } = await supabase.from("plan_change_events").delete({ count: "exact" }).not("id", "is", null);
    if (error) throw new Error(`plan_change_events delete failed: ${error.message}`);
    console.log("Deleted plan_change_events:", count);
  }

  // ── 2. venue_claims — explicit requirement "no venue claims may exist"; cascades venue_claim_notes ──
  {
    const { error, count } = await supabase.from("venue_claims").delete({ count: "exact" }).not("id", "is", null);
    if (error) throw new Error(`venue_claims delete failed: ${error.message}`);
    console.log("Deleted venue_claims (cascades venue_claim_notes):", count);
  }

  // ── 3. claims (legacy pre-venue_claims table) ──
  {
    const { error, count } = await supabase.from("claims").delete({ count: "exact" }).not("id", "is", null);
    if (error) throw new Error(`claims delete failed: ${error.message}`);
    console.log("Deleted claims (legacy):", count);
  }

  // ── 4. operators — cascades operator_memberships + operator_subscriptions;
  //      SETS NULL on operator_impersonation_sessions.operator_id, operator_submissions.operator_id,
  //      venues.created_by_operator_id / updated_by_operator_id / cancelled_by_operator_id,
  //      events.created_by_operator_id / updated_by_operator_id ──
  {
    const { error, count } = await supabase.from("operators").delete({ count: "exact" }).not("id", "is", null);
    if (error) throw new Error(`operators delete failed: ${error.message}`);
    console.log("Deleted operators (cascades memberships + subscriptions):", count);
  }

  // ── 5. venues — reset the remaining ownership-status fields that have no FK-driven cascade
  //      (claimed_by/claimed_at have no FK at all; is_verified and review_confirmations and
  //      cancellation_reason are plain columns). Scoped to only the rows that need it, to avoid
  //      bumping updated_at on unrelated venues. ──
  {
    const { data: venuesToClean } = await supabase
      .from("venues")
      .select("id")
      .or(
        "claimed_by.not.is.null,claimed_at.not.is.null,is_verified.eq.true,cancellation_reason.not.is.null,cancelled_by_operator_id.not.is.null"
      );
    const { data: reviewConfVenues } = await supabase.from("venues").select("id").not("review_confirmations", "eq", "{}");
    const ids = new Set<string>();
    (venuesToClean ?? []).forEach((v) => ids.add(v.id));
    (reviewConfVenues ?? []).forEach((v) => ids.add(v.id));
    const idList = [...ids];

    if (idList.length > 0) {
      const { error, count } = await supabase
        .from("venues")
        .update(
          {
            claimed_by: null,
            claimed_at: null,
            is_verified: false,
            cancellation_reason: null,
            cancelled_by_operator_id: null,
            review_confirmations: {},
          },
          { count: "exact" }
        )
        .in("id", idList);
      if (error) throw new Error(`venues ownership-field reset failed: ${error.message}`);
      console.log("Reset ownership fields on venues:", count, "(ids:", idList.length, ")");
    } else {
      console.log("No venues required ownership-field reset.");
    }
  }

  // ── 6. auth.users — hard delete consumer accounts (cascades consumer_profiles + saved_*) ──
  let consumerDeleted = 0;
  for (const id of consumerAuthIdsToDelete) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) {
      console.error("FAILED to delete consumer auth user", id, error.message);
    } else {
      consumerDeleted++;
    }
  }
  console.log(`Deleted consumer auth.users: ${consumerDeleted}/${consumerAuthIdsToDelete.length}`);

  // ── 7. auth.users — hard delete operator accounts (excluding dual-role platform admins) ──
  let operatorDeleted = 0;
  for (const id of operatorAuthIdsToDelete) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) {
      console.error("FAILED to delete operator auth user", id, error.message);
    } else {
      operatorDeleted++;
    }
  }
  console.log(`Deleted operator auth.users: ${operatorDeleted}/${operatorAuthIdsToDelete.length}`);

  console.log("\nReset execution complete.");
}

main().catch((e) => {
  console.error("RESET EXECUTION FAILED:", e);
  process.exit(1);
});
