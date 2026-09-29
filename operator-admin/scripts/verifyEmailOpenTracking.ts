/**
 * scripts/verifyEmailOpenTracking.ts
 *
 * One-email staging verification of Resend open tracking. Runbook:
 * docs/operations/EMAIL_OPEN_TRACKING_RUNBOOK.md. All logic and safety
 * rules live in src/lib/emailTracking/openTrackingVerification.ts.
 *
 * Usage (from operator-admin/):
 *   npm run email-open-tracking:verify -- --to you@example.com               # dry run (default)
 *   npm run email-open-tracking:verify -- --to you@example.com --send        # sends exactly ONE email
 *   npm run email-open-tracking:verify -- --status <email_messages id>       # read-only status
 * Optional: --tracked-domain updates.happyhourcompass.com (the default)
 *
 * Reads .env.local. Never prints secrets. Never runs in production.
 */
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main(): Promise<number> {
  // Imported after dotenv so every module sees .env.local.
  const { createClient } = await import("@supabase/supabase-js");
  const { Resend } = await import("resend");
  const { parseVerificationArgs, runOpenTrackingVerification } = await import("../src/lib/emailTracking/openTrackingVerification");

  const parsed = parseVerificationArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`ERROR: ${parsed.error}`);
    return 1;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const db = url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
  const noDb = { error: "Supabase admin credentials are not set" };
  const rowColumns =
    "id, send_ref, email_type, environment, venue_id, customer_success_event_id, status, provider_message_id, sent_from_domain, first_opened_at, open_notified_at";

  return runOpenTrackingVerification(parsed.args, {
    env: process.env,
    log: (line) => console.log(line),
    async findVenuesByExactName(name) {
      if (!db) return noDb;
      const { data, error } = await db.from("venues").select("id, name").eq("name", name).limit(5);
      return error ? { error: error.message } : ((data ?? []) as { id: string; name: string }[]);
    },
    async checkRegistryReady() {
      if (!db) return noDb;
      const { error } = await db.from("email_messages").select("id").limit(1);
      return error ? { error: error.message } : { ok: true };
    },
    async listResendDomains() {
      if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY is not set" };
      // Read-only: GET /domains. Never updates a domain.
      const { data, error } = await new Resend(process.env.RESEND_API_KEY).domains.list();
      if (error) return { error: error.message };
      return (data?.data ?? []).map((d) => ({
        name: d.name,
        status: d.status,
        open_tracking: (d as { open_tracking?: boolean }).open_tracking,
        click_tracking: (d as { click_tracking?: boolean }).click_tracking,
      }));
    },
    async findMessageBySendKey(sendKey) {
      if (!db) return noDb;
      const { data, error } = await db.from("email_messages").select(rowColumns).eq("send_key", sendKey).maybeSingle();
      return error ? { error: error.message } : (data as never);
    },
    async findMessageById(id) {
      if (!db) return noDb;
      const { data, error } = await db.from("email_messages").select(rowColumns).eq("id", id).maybeSingle();
      return error ? { error: error.message } : (data as never);
    },
    async listEventsForMessage(id) {
      if (!db) return noDb;
      const { data, error } = await db
        .from("email_provider_events")
        .select("outcome, occurred_at")
        .eq("email_message_id", id)
        .order("occurred_at", { ascending: true });
      return error ? { error: error.message } : ((data ?? []) as { outcome: string | null; occurred_at: string }[]);
    },
  });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("ERROR:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
