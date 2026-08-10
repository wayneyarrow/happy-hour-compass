import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function count(table: string, filter?: (q: any) => any) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count: c, error } = await q;
  if (error) return `ERROR: ${error.message}`;
  return c;
}

async function listAllAuthUsers() {
  const users: { id: string; email: string | null }[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null })));
    if (data.users.length < perPage) break;
    page++;
  }
  return users;
}

async function main() {
  console.log("=== VENUES ===");
  console.log("total venues:", await count("venues"));
  console.log("published venues:", await count("venues", (q) => q.eq("is_published", true)));
  console.log("venues with claimed_by set:", await count("venues", (q) => q.not("claimed_by", "is", null)));
  console.log("venues with created_by_operator_id set:", await count("venues", (q) => q.not("created_by_operator_id", "is", null)));
  console.log("venues with updated_by_operator_id set:", await count("venues", (q) => q.not("updated_by_operator_id", "is", null)));
  console.log("venues source=seed:", await count("venues", (q) => q.eq("source", "seed")));
  console.log("venues by source (non-seed):", await count("venues", (q) => q.neq("source", "seed")));

  console.log("\n=== OPERATORS ===");
  console.log("operators total:", await count("operators"));
  console.log("operator_memberships total:", await count("operator_memberships"));
  console.log("operator_subscriptions total:", await count("operator_subscriptions"));
  console.log("plan_change_events total:", await count("plan_change_events"));
  console.log("operator_impersonation_sessions total:", await count("operator_impersonation_sessions"));
  console.log("operator_submissions total:", await count("operator_submissions"));
  console.log("operator_submission_notes total:", await count("operator_submission_notes"));

  console.log("\n=== CLAIMS ===");
  console.log("venue_claims total:", await count("venue_claims"));
  console.log("venue_claim_notes total:", await count("venue_claim_notes"));
  console.log("claims (legacy) total:", await count("claims"));

  console.log("\n=== CONSUMERS ===");
  console.log("consumer_profiles total:", await count("consumer_profiles"));
  console.log("consumer_saved_venues total:", await count("consumer_saved_venues"));
  console.log("consumer_saved_events total:", await count("consumer_saved_events"));
  console.log("consumer_saved_guides total:", await count("consumer_saved_guides"));

  console.log("\n=== OTHER / OUT OF SCOPE CHECK ===");
  console.log("venue_suggestions total:", await count("venue_suggestions"));
  console.log("contact_messages total:", await count("contact_messages"));
  console.log("industry_reads_feedback total:", await count("industry_reads_feedback"));
  console.log("audit_logs total:", await count("audit_logs"));
  console.log("venue_notes total:", await count("venue_notes"));
  console.log("platform_admins total:", await count("platform_admins"));

  console.log("\n=== EVENTS / GUIDES (must remain unchanged) ===");
  console.log("events total:", await count("events"));
  console.log("content_guides total:", await count("content_guides"));

  console.log("\n=== AUTH.USERS CROSS-REFERENCE ===");
  const authUsers = await listAllAuthUsers();
  console.log("auth.users total:", authUsers.length);

  const { data: operatorRows } = await supabase.from("operators").select("id,email");
  const { data: consumerRows } = await supabase.from("consumer_profiles").select("id,email");
  const { data: adminRows } = await supabase.from("platform_admins").select("email,status");

  const operatorEmails = new Set((operatorRows ?? []).map((o) => (o.email ?? "").toLowerCase()));
  const consumerIds = new Set((consumerRows ?? []).map((c) => c.id));
  const adminEmails = new Set((adminRows ?? []).map((a) => (a.email ?? "").toLowerCase()));

  let opMatch = 0, consumerMatch = 0, adminMatch = 0, unclassified = 0;
  const unclassifiedList: { id: string; email: string | null }[] = [];
  const dualRole: { id: string; email: string | null; roles: string[] }[] = [];

  for (const u of authUsers) {
    const email = (u.email ?? "").toLowerCase();
    const roles: string[] = [];
    if (operatorEmails.has(email)) roles.push("operator");
    if (consumerIds.has(u.id)) roles.push("consumer");
    if (adminEmails.has(email)) roles.push("platform_admin");

    if (roles.length === 0) {
      unclassified++;
      unclassifiedList.push(u);
    } else {
      if (roles.length > 1) dualRole.push({ id: u.id, email: u.email, roles });
      if (roles.includes("operator")) opMatch++;
      if (roles.includes("consumer")) consumerMatch++;
      if (roles.includes("platform_admin")) adminMatch++;
    }
  }

  console.log("auth.users matched to operators table:", opMatch);
  console.log("auth.users matched to consumer_profiles table:", consumerMatch);
  console.log("auth.users matched to platform_admins table:", adminMatch);
  console.log("auth.users with NO match in any of the three (unclassified):", unclassified);
  console.log("unclassified users:", JSON.stringify(unclassifiedList, null, 2));
  console.log("dual-role users (overlap — must be handled carefully):", JSON.stringify(dualRole, null, 2));

  console.log("\nplatform_admins rows:", JSON.stringify(adminRows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
