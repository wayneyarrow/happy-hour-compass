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
  const { data: operators } = await supabase.from("operators").select("id,email");
  const { data: consumers } = await supabase.from("consumer_profiles").select("id,email");
  const { data: admins } = await supabase.from("platform_admins").select("email");
  const authUsers = await listAllAuthUsers();

  const adminEmails = new Set((admins ?? []).map((a) => a.email.toLowerCase()));
  const operatorEmails = new Set((operators ?? []).map((o) => (o.email ?? "").toLowerCase()));
  const consumerIds = new Set((consumers ?? []).map((c) => c.id));

  const operatorAuthUsersToDelete = authUsers.filter(
    (u) => operatorEmails.has((u.email ?? "").toLowerCase()) && !adminEmails.has((u.email ?? "").toLowerCase())
  );
  const preservedDualRole = authUsers.filter(
    (u) => operatorEmails.has((u.email ?? "").toLowerCase()) && adminEmails.has((u.email ?? "").toLowerCase())
  );
  const consumerAuthUsersToDelete = authUsers.filter((u) => consumerIds.has(u.id));

  console.log("=== AUTH.USERS DELETION PLAN ===");
  console.log("Operator auth.users to DELETE:", operatorAuthUsersToDelete.length);
  console.log(JSON.stringify(operatorAuthUsersToDelete, null, 2));
  console.log("\nDual-role (operator+platform_admin) auth.users to PRESERVE (operators row still deleted):", preservedDualRole.length);
  console.log(JSON.stringify(preservedDualRole, null, 2));
  console.log("\nConsumer auth.users to DELETE:", consumerAuthUsersToDelete.length);
  console.log(JSON.stringify(consumerAuthUsersToDelete.map((u) => u.id), null, 2));

  console.log("\n=== VENUE OWNERSHIP-FIELD RESET PLAN ===");
  const { data: venuesToClean } = await supabase
    .from("venues")
    .select("id,name,claimed_by,claimed_at,is_verified,cancellation_reason,cancelled_by_operator_id,review_confirmations")
    .or(
      "claimed_by.not.is.null,claimed_at.not.is.null,is_verified.eq.true,cancellation_reason.not.is.null,cancelled_by_operator_id.not.is.null"
    );
  const { data: reviewConfVenues } = await supabase
    .from("venues")
    .select("id,name,review_confirmations")
    .not("review_confirmations", "eq", "{}");

  const unionIds = new Set<string>();
  (venuesToClean ?? []).forEach((v) => unionIds.add(v.id));
  (reviewConfVenues ?? []).forEach((v) => unionIds.add(v.id));

  console.log("Venues requiring ownership-field reset (union):", unionIds.size);
  console.log(JSON.stringify([...unionIds], null, 2));

  console.log("\n=== ROW COUNTS TO DELETE (child tables) ===");
  for (const t of ["plan_change_events", "venue_claims", "venue_claim_notes", "claims"]) {
    const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
    console.log(t, ":", count);
  }
  const { count: opCount } = await supabase.from("operators").select("*", { count: "exact", head: true });
  console.log("operators :", opCount);
}
main();
