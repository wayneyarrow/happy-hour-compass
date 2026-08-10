import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const TARGET_IDS = [
  "b5992770-bdbf-4a11-9914-5cb8b595535a", // wayne.yarrow+2@gmail.com
  "1905dd1c-b1d6-41ae-be04-924f249106e6", // alexolsen1234@gmail.com
  "776a9cf6-501d-41f6-9e59-1064574a7901", // alexolsen@gmail.com
  "235c69dc-9692-464d-83c9-46649c191361", // andigo111@gmail.com
];

async function main() {
  // Full auth.users detail for each
  for (const id of TARGET_IDS) {
    const { data, error } = await supabase.auth.admin.getUserById(id);
    if (error) {
      console.log(id, "ERROR fetching user:", error.message);
      continue;
    }
    const u = data.user;
    console.log("\n================================================================");
    console.log("ID:", u?.id);
    console.log("Email:", u?.email);
    console.log("Created at:", u?.created_at);
    console.log("Last sign in at:", u?.last_sign_in_at);
    console.log("Email confirmed at:", u?.email_confirmed_at);
    console.log("Confirmed at:", u?.confirmed_at);
    console.log("Phone:", u?.phone);
    console.log("App metadata:", JSON.stringify(u?.app_metadata));
    console.log("User metadata:", JSON.stringify(u?.user_metadata));
    console.log("Identities:", JSON.stringify(u?.identities?.map((i) => ({ provider: i.provider, created_at: i.created_at }))));
    console.log("Banned until:", (u as any)?.banned_until);
    console.log("Is anonymous:", (u as any)?.is_anonymous);
  }

  const emails = ["wayne.yarrow+2@gmail.com", "alexolsen1234@gmail.com", "alexolsen@gmail.com", "andigo111@gmail.com"];

  console.log("\n\n=== CROSS-TABLE REFERENCE CHECK ===");

  // operators (already known: no match, but re-verify post state)
  const { data: op } = await supabase.from("operators").select("id,email").in("email", emails);
  console.log("operators matches:", JSON.stringify(op));

  // consumer_profiles by id and email
  const { data: cp1 } = await supabase.from("consumer_profiles").select("id,email").in("id", TARGET_IDS);
  const { data: cp2 } = await supabase.from("consumer_profiles").select("id,email").in("email", emails);
  console.log("consumer_profiles matches by id:", JSON.stringify(cp1));
  console.log("consumer_profiles matches by email:", JSON.stringify(cp2));

  // platform_admins
  const { data: pa } = await supabase.from("platform_admins").select("email").in("email", emails);
  console.log("platform_admins matches:", JSON.stringify(pa));

  // operator_memberships.auth_user_id
  const { data: om } = await supabase.from("operator_memberships").select("*").in("auth_user_id", TARGET_IDS);
  console.log("operator_memberships (auth_user_id) matches:", JSON.stringify(om));

  // venue_notes.created_by
  const { data: vn } = await supabase.from("venue_notes").select("id,venue_id,note,created_by,created_by_email,created_at").in("created_by", TARGET_IDS);
  console.log("venue_notes (created_by) matches:", JSON.stringify(vn, null, 2));
  const { data: vnByEmail } = await supabase.from("venue_notes").select("id,venue_id,note,created_by,created_by_email,created_at").in("created_by_email", emails);
  console.log("venue_notes (created_by_email) matches:", JSON.stringify(vnByEmail, null, 2));

  // operator_submission_notes.created_by
  const { data: osn } = await supabase.from("operator_submission_notes").select("*").in("created_by", TARGET_IDS);
  console.log("operator_submission_notes (created_by) matches:", JSON.stringify(osn, null, 2));

  // operator_impersonation_sessions.founder_user_id / founder_email
  const { data: imp1 } = await supabase.from("operator_impersonation_sessions").select("*").in("founder_user_id", TARGET_IDS);
  const { data: imp2 } = await supabase.from("operator_impersonation_sessions").select("*").in("founder_email", emails);
  console.log("operator_impersonation_sessions (founder_user_id) matches:", JSON.stringify(imp1, null, 2));
  console.log("operator_impersonation_sessions (founder_email) matches:", JSON.stringify(imp2, null, 2));

  // audit_logs.actor_email
  const { data: al } = await supabase.from("audit_logs").select("*").in("actor_email", emails);
  console.log("audit_logs (actor_email) matches:", JSON.stringify(al, null, 2));

  // operator_submissions.email
  const { data: os } = await supabase.from("operator_submissions").select("id,operator_name,email,venue_name,status,submitted_at").in("email", emails);
  console.log("operator_submissions (email) matches:", JSON.stringify(os, null, 2));

  // venue_claims.email (all rows already deleted, but check just in case any remain)
  const { data: vc } = await supabase.from("venue_claims").select("id,email").in("email", emails);
  console.log("venue_claims (email) matches (expect none, table cleared):", JSON.stringify(vc, null, 2));

  // venue_claim_notes.created_by
  const { data: vcn } = await supabase.from("venue_claim_notes").select("*").in("created_by", TARGET_IDS);
  console.log("venue_claim_notes (created_by) matches:", JSON.stringify(vcn, null, 2));

  // contact_messages.email (plain text, informational only)
  const { data: cm } = await supabase.from("contact_messages").select("id,name,email,message,created_at").in("email", emails);
  console.log("contact_messages (email) matches (informational only, not an account ref):", JSON.stringify(cm, null, 2));

  // venue_suggestions - no email column expected, skip

  // consumer_saved_venues/events/guides by id (should be none since consumer_profiles are gone / never existed)
  const { data: csv } = await supabase.from("consumer_saved_venues").select("*").in("consumer_id", TARGET_IDS);
  console.log("consumer_saved_venues matches:", JSON.stringify(csv));

  // CONTROL_PANEL_ADMIN_EMAILS env allowlist check
  const allowlist = (process.env.CONTROL_PANEL_ADMIN_EMAILS ?? "").split(/[,\n]/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  console.log("\nCONTROL_PANEL_ADMIN_EMAILS allowlist:", allowlist);
  console.log("Any target email in allowlist:", emails.filter((e) => allowlist.includes(e.toLowerCase())));
}
main();
