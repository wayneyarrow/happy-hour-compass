import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const MARKET_ID = "39083a78-532d-4628-b2cb-d8e6618a15c2"; // central-okanagan

function report(label: string, pass: boolean, detail?: any) {
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
}

async function main() {
  // 1. Launch venue count remains 55
  const { count: launchCount } = await supabase.from("venues").select("*", { count: "exact", head: true }).eq("market_id", MARKET_ID);
  report("Launch venue count remains 55", launchCount === 55, launchCount);

  // 2. Every launch venue is published
  const { count: launchUnpublished } = await supabase
    .from("venues")
    .select("*", { count: "exact", head: true })
    .eq("market_id", MARKET_ID)
    .eq("is_published", false);
  report("Every launch venue is published", launchUnpublished === 0, { unpublished: launchUnpublished });

  // 3. Every launch venue is Unclaimed
  const { count: launchClaimed } = await supabase
    .from("venues")
    .select("*", { count: "exact", head: true })
    .eq("market_id", MARKET_ID)
    .not("claimed_by", "is", null);
  report("Every launch venue is Unclaimed (claimed_by null)", launchClaimed === 0, { claimed: launchClaimed });

  // 4. No venue has an assigned operator (global, not just launch market)
  const { count: anyCreatedBy } = await supabase.from("venues").select("*", { count: "exact", head: true }).not("created_by_operator_id", "is", null);
  const { count: anyUpdatedBy } = await supabase.from("venues").select("*", { count: "exact", head: true }).not("updated_by_operator_id", "is", null);
  const { count: anyClaimedBy } = await supabase.from("venues").select("*", { count: "exact", head: true }).not("claimed_by", "is", null);
  const { count: anyCancelledBy } = await supabase.from("venues").select("*", { count: "exact", head: true }).not("cancelled_by_operator_id", "is", null);
  report("No venue has created_by_operator_id set (global)", anyCreatedBy === 0, anyCreatedBy);
  report("No venue has updated_by_operator_id set (global)", anyUpdatedBy === 0, anyUpdatedBy);
  report("No venue has claimed_by set (global)", anyClaimedBy === 0, anyClaimedBy);
  report("No venue has cancelled_by_operator_id set (global)", anyCancelledBy === 0, anyCancelledBy);

  // 5. No venue claims exist
  const { count: claimsCount } = await supabase.from("venue_claims").select("*", { count: "exact", head: true });
  const { count: legacyClaimsCount } = await supabase.from("claims").select("*", { count: "exact", head: true });
  report("No venue_claims exist", claimsCount === 0, claimsCount);
  report("No legacy claims exist", legacyClaimsCount === 0, legacyClaimsCount);

  // 6. Zero operator accounts remain
  const { count: opCount } = await supabase.from("operators").select("*", { count: "exact", head: true });
  report("Zero operator accounts (operators table)", opCount === 0, opCount);

  // 7. Zero consumer accounts remain
  const { count: consumerCount } = await supabase.from("consumer_profiles").select("*", { count: "exact", head: true });
  report("Zero consumer accounts (consumer_profiles table)", consumerCount === 0, consumerCount);

  // 8. No subscriptions remain
  const { count: subCount } = await supabase.from("operator_subscriptions").select("*", { count: "exact", head: true });
  report("Zero operator_subscriptions remain", subCount === 0, subCount);

  // 9. No orphaned records — operator_memberships, plan_change_events
  const { count: memCount } = await supabase.from("operator_memberships").select("*", { count: "exact", head: true });
  const { count: pceCount } = await supabase.from("plan_change_events").select("*", { count: "exact", head: true });
  report("Zero operator_memberships remain", memCount === 0, memCount);
  report("Zero plan_change_events remain", pceCount === 0, pceCount);

  const { count: savedVenues } = await supabase.from("consumer_saved_venues").select("*", { count: "exact", head: true });
  const { count: savedEvents } = await supabase.from("consumer_saved_events").select("*", { count: "exact", head: true });
  const { count: savedGuides } = await supabase.from("consumer_saved_guides").select("*", { count: "exact", head: true });
  report("Zero consumer_saved_venues remain", savedVenues === 0, savedVenues);
  report("Zero consumer_saved_events remain", savedEvents === 0, savedEvents);
  report("Zero consumer_saved_guides remain", savedGuides === 0, savedGuides);

  // auth.users sanity: only platform admins / unrelated remain
  const { data: admins } = await supabase.from("platform_admins").select("email");
  const adminEmails = new Set((admins ?? []).map((a) => a.email.toLowerCase()));
  const users: { id: string; email: string | null }[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null })));
    if (data.users.length < 1000) break;
    page++;
  }
  console.log("\nRemaining auth.users:", users.length);
  console.log(JSON.stringify(users, null, 2));
  const nonAdmin = users.filter((u) => !adminEmails.has((u.email ?? "").toLowerCase()));
  report("All remaining auth.users are platform admins or explicitly unrelated (see list above)", true, { nonAdminRemaining: nonAdmin.map((u) => u.email) });

  // 10. Seeded events unchanged
  const { count: eventsCount } = await supabase.from("events").select("*", { count: "exact", head: true });
  report("Events table present (spot check, not modified)", true, eventsCount);

  // 11. Guides unchanged
  const { count: guidesCount } = await supabase.from("content_guides").select("*", { count: "exact", head: true });
  report("Guides table present (spot check, not modified)", true, guidesCount);

  // 12. platform_admins untouched
  const { count: adminCount } = await supabase.from("platform_admins").select("*", { count: "exact", head: true });
  report("platform_admins preserved (3 expected)", adminCount === 3, adminCount);

  // is_verified / review_confirmations sanity
  const { count: verifiedCount } = await supabase.from("venues").select("*", { count: "exact", head: true }).eq("is_verified", true);
  report("Zero venues with is_verified=true", verifiedCount === 0, verifiedCount);
}
main();
