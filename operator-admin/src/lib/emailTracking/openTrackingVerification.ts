import { randomUUID } from "node:crypto";
import { sendTransactionalEmail } from "@/lib/email";
import { renderVenueViewMilestoneEmail } from "@/lib/customerSuccess/milestoneEmailTemplate";
import { CUSTOMER_SUCCESS_FROM, CUSTOMER_SUCCESS_REPLY_TO } from "@/lib/customerSuccess/processCustomerSuccessDeliveries";
import { getTrackedSenderDomain } from "./emailTrackingConfig";
import { computeSendRef, resolveEmailEnvironment, usesTrackedSender } from "./emailTrackingPolicy";
import { planSendVariants } from "./trackedSend";

/**
 * One-email staging verification of Resend open tracking — the logic behind
 * scripts/verifyEmailOpenTracking.ts (see
 * docs/operations/EMAIL_OPEN_TRACKING_RUNBOOK.md). All I/O is injected so
 * every safety rule is unit-tested.
 *
 * SAFETY RULES (each enforced below, each tested):
 *   - Dry run by default. Exactly ONE email is sent, and only with `--send`.
 *   - The recipient must be passed explicitly with `--to` — never read from
 *     an env var, never defaulted, never a database value.
 *   - The only venue association allowed is the existing venue named exactly
 *     TEST_VENUE_NAME; zero or multiple matches ⇒ refuse.
 *   - Refuses to run in a production runtime (VERCEL_ENV=production).
 *   - Uses the NORMAL sending path (sendTransactionalEmail, the real
 *     milestone template and the real Customer Success sender), but never
 *     reads, creates, or advances a customer_success_events row and never
 *     runs the Customer Success cron — the email is linked to the test venue
 *     only.
 *   - `--send` additionally requires, via read-only Resend API checks: the
 *     tracked subdomain verified with open tracking ON and click tracking
 *     OFF, and the root domain with open AND click tracking OFF.
 *   - Tracking flags are enabled for THIS PROCESS ONLY while sending and
 *     restored immediately after — no deployment setting changes.
 *   - Never prints secrets (only whether a credential is present). No
 *     verification code is involved at all.
 */

export const TEST_VENUE_NAME = "HHC Verification Test Venue";
export const DEFAULT_TRACKED_DOMAIN = "updates.happyhourcompass.com";
export const ROOT_DOMAIN = "happyhourcompass.com";
export const TEST_MILESTONE = 50;
export const TEST_SUBJECT_PREFIX = "[HHC open-tracking test] ";

export type VerificationArgs =
  | { mode: "dry_run" | "send"; to: string; trackedDomain: string }
  | { mode: "status"; emailMessageId: string };

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseVerificationArgs(argv: string[]): { ok: true; args: VerificationArgs } | { ok: false; error: string } {
  const known = new Set(["--to", "--send", "--tracked-domain", "--status"]);
  let to: string | null = null;
  let send = false;
  let trackedDomainRaw: string | null = null;
  let status: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known.has(a)) return { ok: false, error: `Unknown argument: ${a}` };
    if (a === "--send") {
      send = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) return { ok: false, error: `${a} requires a value` };
    i++;
    if (a === "--to") {
      if (to !== null) return { ok: false, error: "--to may be given only once (exactly one recipient)" };
      to = value.trim();
    } else if (a === "--tracked-domain") {
      trackedDomainRaw = value;
    } else if (a === "--status") {
      status = value.trim();
    }
  }

  if (status !== null) {
    if (send || to !== null) return { ok: false, error: "--status cannot be combined with --send or --to" };
    if (!UUID_RE.test(status)) return { ok: false, error: "--status takes the email_messages id printed by a --send run" };
    return { ok: true, args: { mode: "status", emailMessageId: status } };
  }

  if (!to) return { ok: false, error: "--to <your test inbox> is required — the recipient is never defaulted" };
  if (!EMAIL_RE.test(to) || to.includes(",")) return { ok: false, error: "--to must be exactly one email address" };

  const trackedDomain = getTrackedSenderDomain({ EMAIL_TRACKED_SENDER_DOMAIN: trackedDomainRaw ?? DEFAULT_TRACKED_DOMAIN } as unknown as NodeJS.ProcessEnv);
  if (!trackedDomain) return { ok: false, error: "--tracked-domain must be a subdomain of happyhourcompass.com" };

  return { ok: true, args: { mode: send ? "send" : "dry_run", to, trackedDomain } };
}

export type ResendDomainInfo = { name: string; status: string; open_tracking?: boolean; click_tracking?: boolean };

export type RegistryRowSnapshot = {
  id: string;
  send_ref: string;
  email_type: string;
  environment: string;
  venue_id: string | null;
  customer_success_event_id: string | null;
  status: string;
  provider_message_id: string | null;
  sent_from_domain: string | null;
  first_opened_at: string | null;
  open_notified_at: string | null;
};

export type VerificationDeps = {
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  findVenuesByExactName: (name: string) => Promise<{ id: string; name: string }[] | { error: string }>;
  checkRegistryReady: () => Promise<{ ok: true } | { error: string }>;
  listResendDomains: () => Promise<ResendDomainInfo[] | { error: string }>;
  findMessageBySendKey: (sendKey: string) => Promise<RegistryRowSnapshot | null | { error: string }>;
  findMessageById: (id: string) => Promise<RegistryRowSnapshot | null | { error: string }>;
  listEventsForMessage: (id: string) => Promise<{ outcome: string | null; occurred_at: string }[] | { error: string }>;
  sendEmail?: typeof sendTransactionalEmail;
  randomId?: () => string;
};

const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

export function isProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL_ENV === "production";
}

/** Read-only provider state required before a send. */
export function checkResendDomains(domains: ResendDomainInfo[], trackedDomain: string): string[] {
  const problems: string[] = [];
  const root = domains.find((d) => d.name === ROOT_DOMAIN);
  const tracked = domains.find((d) => d.name === trackedDomain);
  if (!root) problems.push(`${ROOT_DOMAIN} is not in this Resend account`);
  else {
    if (root.open_tracking) problems.push(`${ROOT_DOMAIN} has OPEN tracking enabled — it must stay off (it would pixel verification codes and password resets)`);
    if (root.click_tracking) problems.push(`${ROOT_DOMAIN} has CLICK tracking enabled — it must stay off`);
  }
  if (!tracked) problems.push(`${trackedDomain} has not been added to Resend`);
  else {
    if (tracked.status !== "verified") problems.push(`${trackedDomain} is not verified (status: ${tracked.status})`);
    if (!tracked.open_tracking) problems.push(`${trackedDomain} does not have open tracking enabled`);
    if (tracked.click_tracking) problems.push(`${trackedDomain} has CLICK tracking enabled — it must stay off`);
  }
  return problems;
}

/** Proof, printed on every run, that a milestone sent with the flag OFF is the legacy request. */
export function describeFlagOffMilestoneRequest(env: NodeJS.ProcessEnv): string {
  const [first] = planSendVariants({
    from: CUSTOMER_SUCCESS_FROM,
    replyTo: CUSTOMER_SUCCESS_REPLY_TO,
    emailType: "customer_success_milestone",
    sendRef: computeSendRef("hhc-customer-success:example"),
    environment: resolveEmailEnvironment(env),
    trackingEnabled: false,
    trackedDomain: getTrackedSenderDomain(env),
    useTrackedSender: usesTrackedSender("customer_success_milestone"),
  });
  return `From ${first.from} · Reply-To ${first.replyTo ?? "(none)"} · tags: ${first.tags ? "YES (unexpected)" : "none"}`;
}

export async function runOpenTrackingVerification(args: VerificationArgs, deps: VerificationDeps): Promise<number> {
  const { log, env } = deps;

  if (isProductionRuntime(env)) {
    log("REFUSED: this script never runs in a production runtime (VERCEL_ENV=production).");
    return 1;
  }

  if (args.mode === "status") return printStatus(args.emailMessageId, deps);

  log(`Mode: ${args.mode === "send" ? "SEND (exactly one email)" : "DRY RUN (nothing will be sent)"}`);
  log(`Recipient (explicit --to): ${args.to}`);
  log(`Credentials present: RESEND_API_KEY=${env.RESEND_API_KEY ? "yes" : "NO"}, SUPABASE=${env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY ? "yes" : "NO"}`);
  log(`Runtime environment recorded on the registry row: ${resolveEmailEnvironment(env)} (never 'production' ⇒ never posts to Slack)`);
  log(`Production check — a milestone with EMAIL_OPEN_TRACKING_ENABLED unset is sent as: ${describeFlagOffMilestoneRequest(env)}`);

  const problems: string[] = [];
  if (!env.RESEND_API_KEY) problems.push("RESEND_API_KEY is not set");
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) problems.push("Supabase admin credentials are not set");

  const ready = await deps.checkRegistryReady();
  if (isErr(ready)) problems.push(`email registry not ready (is migration 102 applied?): ${ready.error}`);
  else log("Registry: email_messages is reachable.");

  const venues = await deps.findVenuesByExactName(TEST_VENUE_NAME);
  let venue: { id: string; name: string } | null = null;
  if (isErr(venues)) problems.push(`venue lookup failed: ${venues.error}`);
  else if (venues.length !== 1) problems.push(`expected exactly one venue named "${TEST_VENUE_NAME}", found ${venues.length}`);
  else {
    venue = venues[0];
    log(`Test venue: ${venue.name} (${venue.id})`);
  }

  const domains = await deps.listResendDomains();
  if (isErr(domains)) problems.push(`Resend domain check failed (read-only): ${domains.error}`);
  else {
    const domainProblems = checkResendDomains(domains, args.trackedDomain);
    if (domainProblems.length === 0) log(`Resend: ${args.trackedDomain} verified with open tracking on; click tracking off; ${ROOT_DOMAIN} untracked.`);
    problems.push(...domainProblems);
  }

  const sendKey = `hhc-email-open-verification:${(deps.randomId ?? randomUUID)()}`;
  const rendered = venue
    ? renderVenueViewMilestoneEmail({ milestone: TEST_MILESTONE, firstName: "there", venueName: venue.name })
    : null;
  const subject = rendered ? `${TEST_SUBJECT_PREFIX}${rendered.subject}` : "(unavailable)";
  const [planned] = planSendVariants({
    from: CUSTOMER_SUCCESS_FROM,
    replyTo: CUSTOMER_SUCCESS_REPLY_TO,
    emailType: "customer_success_milestone",
    sendRef: computeSendRef(sendKey),
    environment: resolveEmailEnvironment(env),
    trackingEnabled: true,
    trackedDomain: args.trackedDomain,
    useTrackedSender: true,
  });
  log(`Planned email: type customer_success_milestone · From ${planned.from} · Reply-To ${planned.replyTo} · Subject "${subject}"`);
  log(`Planned send key: ${sendKey} · send_ref: ${computeSendRef(sendKey)}`);
  log("No customer_success_events row is read, created, or advanced; the Customer Success cron is not run.");

  if (problems.length > 0) {
    log("Preflight problems:");
    for (const p of problems) log(`  - ${p}`);
  }

  if (args.mode === "dry_run") {
    log(problems.length ? "DRY RUN complete — fix the problems above before --send." : "DRY RUN complete — preflight passed. Re-run with --send to send exactly one email.");
    return problems.length ? 1 : 0;
  }

  if (problems.length > 0 || !venue || !rendered) {
    log("REFUSED: --send requires every preflight check to pass. Nothing was sent.");
    return 1;
  }

  // Enable tracking for THIS PROCESS ONLY, send once, restore.
  const saved = { enabled: env.EMAIL_OPEN_TRACKING_ENABLED, domain: env.EMAIL_TRACKED_SENDER_DOMAIN };
  env.EMAIL_OPEN_TRACKING_ENABLED = "true";
  env.EMAIL_TRACKED_SENDER_DOMAIN = args.trackedDomain;
  let result: { ok: boolean; id?: string; error?: string };
  try {
    result = await (deps.sendEmail ?? sendTransactionalEmail)({
      type: "customer_success_milestone",
      to: args.to,
      subject,
      html: rendered.html,
      text: rendered.text,
      criticality: "standard",
      from: CUSTOMER_SUCCESS_FROM,
      replyTo: CUSTOMER_SUCCESS_REPLY_TO,
      idempotencyKey: sendKey,
      record: { venueId: venue.id, context: { milestone: TEST_MILESTONE } },
    });
  } finally {
    if (saved.enabled === undefined) delete env.EMAIL_OPEN_TRACKING_ENABLED;
    else env.EMAIL_OPEN_TRACKING_ENABLED = saved.enabled;
    if (saved.domain === undefined) delete env.EMAIL_TRACKED_SENDER_DOMAIN;
    else env.EMAIL_TRACKED_SENDER_DOMAIN = saved.domain;
  }

  if (!result.ok) {
    log(`SEND FAILED: ${result.error ?? "unknown error"}. Do not re-run blindly — check the Resend log first.`);
    return 1;
  }
  log(`Sent. Resend message id: ${result.id ?? "(none returned)"}`);

  const row = await deps.findMessageBySendKey(sendKey);
  if (isErr(row) || !row) {
    log(`WARNING: the registry row could not be read back (${isErr(row) ? row.error : "not found"}). The open cannot be matched without it.`);
    return 1;
  }
  printRow(row, log);
  if (row.sent_from_domain !== args.trackedDomain) {
    log(`WARNING: the email was sent from ${row.sent_from_domain ?? "unknown"}, not ${args.trackedDomain} — Resend will NOT report an open for it.`);
    return 1;
  }
  log(`Next: open the email in ${args.to}, then run: npm run email-open-tracking:verify -- --status ${row.id}`);
  return 0;
}

function printRow(row: RegistryRowSnapshot, log: (l: string) => void) {
  log(`Registry row (email_messages.id): ${row.id}`);
  log(`  send_ref: ${row.send_ref} · provider_message_id: ${row.provider_message_id ?? "(none)"}`);
  log(`  email_type: ${row.email_type} · environment: ${row.environment} · status: ${row.status}`);
  log(`  venue_id: ${row.venue_id ?? "(none)"} · customer_success_event_id: ${row.customer_success_event_id ?? "(none — expected)"}`);
  log(`  sent_from_domain: ${row.sent_from_domain ?? "(none)"}`);
  log(`  first_opened_at: ${row.first_opened_at ?? "(not opened yet)"} · open_notified_at: ${row.open_notified_at ?? "(none — expected: non-production never posts to Slack)"}`);
}

async function printStatus(id: string, deps: VerificationDeps): Promise<number> {
  const row = await deps.findMessageById(id);
  if (isErr(row) || !row) {
    deps.log(`No registry row ${id} (${isErr(row) ? row.error : "not found"}).`);
    return 1;
  }
  printRow(row, deps.log);
  const events = await deps.listEventsForMessage(id);
  if (isErr(events)) deps.log(`Webhook events: lookup failed (${events.error})`);
  else deps.log(`Webhook events matched: ${events.length}${events.length ? " — " + events.map((e) => `${e.outcome ?? "pending"}@${e.occurred_at}`).join(", ") : ""}`);
  return 0;
}
