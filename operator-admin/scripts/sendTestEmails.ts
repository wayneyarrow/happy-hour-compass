/**
 * scripts/sendTestEmails.ts
 *
 * DEV ONLY — sends representative examples of the five most important
 * operator-facing emails to a configurable address for Gmail rendering review.
 *
 * Does NOT touch the database, create any records, or modify production state.
 * Uses realistic fake data and placeholder links throughout.
 *
 * Usage:
 *   npx tsx scripts/sendTestEmails.ts --to you@example.com
 *
 * Or set TEST_EMAIL_RECIPIENT in .env.local and run without the flag:
 *   npx tsx scripts/sendTestEmails.ts
 *
 * Requires RESEND_API_KEY to be set (reads from .env.local automatically).
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local before importing any module that reads process.env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import {
  sendClaimSubmissionConfirmationEmail,
  sendPasswordSetupEmail,
  sendClaimMoreInfoEmail,
  sendOperatorActivationEmail,
  sendMemberInviteEmail,
} from "@/lib/email";

// ── Resolve recipient ─────────────────────────────────────────────────────────

function resolveRecipient(): string {
  // Accept --to flag
  const toFlagIndex = process.argv.indexOf("--to");
  if (toFlagIndex !== -1 && process.argv[toFlagIndex + 1]) {
    return process.argv[toFlagIndex + 1];
  }
  // Fall back to env var
  if (process.env.TEST_EMAIL_RECIPIENT) {
    return process.env.TEST_EMAIL_RECIPIENT;
  }
  console.error(
    "\nError: No recipient specified.\n" +
    "Usage: npx tsx scripts/sendTestEmails.ts --to you@example.com\n" +
    "Or set TEST_EMAIL_RECIPIENT in .env.local\n"
  );
  process.exit(1);
}

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE = {
  firstName:   "Sarah",
  lastName:    "Mitchell",
  venueName:   "The Tap Room",
  phone:       "(604) 555-0147",
  claimId:     "test-claim-abc123",
  submissionId:"test-sub-def456",
  // Placeholder links — clearly non-functional for visual review only
  setupLink:   "https://happyhourcompass.com/test/create-password?token=PREVIEW_TOKEN_NOT_REAL",
  moreInfoUrl: "https://happyhourcompass.com/test/claim/more-info/PREVIEW_TOKEN_NOT_REAL",
  inviteUrl:   "https://happyhourcompass.com/test/invite/PREVIEW_TOKEN_NOT_REAL",
  inviterName: "Wayne",
  submittedAt: new Date().toLocaleString("en-CA", {
    timeZone:     "America/Vancouver",
    dateStyle:    "medium",
    timeStyle:    "short",
  }),
};

// ── Emails to send ────────────────────────────────────────────────────────────

type EmailJob = {
  label: string;
  send:  () => Promise<{ ok: boolean; error?: string }>;
};

function buildJobs(to: string): EmailJob[] {
  return [
    {
      label: "1/5  Claim received confirmation  (\"We received your claim\")",
      send:  () => sendClaimSubmissionConfirmationEmail({
        to,
        firstName: SAMPLE.firstName,
        venueName: SAMPLE.venueName,
      }),
    },
    {
      label: "2/5  Claim approved — password setup  (\"Set up my password\")",
      send:  () => sendPasswordSetupEmail({
        to,
        firstName: SAMPLE.firstName,
        setupLink: SAMPLE.setupLink,
      }),
    },
    {
      label: "3/5  Claim more info needed  (\"A few more details needed\")",
      send:  () => sendClaimMoreInfoEmail({
        to,
        firstName:   SAMPLE.firstName,
        venueName:   SAMPLE.venueName,
        moreInfoUrl: SAMPLE.moreInfoUrl,
      }),
    },
    {
      label: "4/5  Operator account activation  (\"Your venue is on Happy Hour Compass\")",
      send:  () => sendOperatorActivationEmail({
        to,
        firstName: SAMPLE.firstName,
        setupLink: SAMPLE.setupLink,
      }),
    },
    {
      label: "5/5  Team member invitation  (\"You've been invited to manage...\")",
      send:  () => sendMemberInviteEmail({
        to,
        firstName:   SAMPLE.firstName,
        venueName:   SAMPLE.venueName,
        inviterName: SAMPLE.inviterName,
        inviteUrl:   SAMPLE.inviteUrl,
      }),
    },
  ];
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  const to = resolveRecipient();

  console.log("\n──────────────────────────────────────────────");
  console.log("  HHC Email Rendering Test");
  console.log("──────────────────────────────────────────────");
  console.log(`  Recipient : ${to}`);
  console.log(`  Venue     : ${SAMPLE.venueName}`);
  console.log(`  Name      : ${SAMPLE.firstName} ${SAMPLE.lastName}`);
  console.log("──────────────────────────────────────────────\n");

  const jobs = buildJobs(to);
  let passed = 0;
  let failed = 0;

  for (const job of jobs) {
    process.stdout.write(`  Sending  ${job.label} … `);
    const result = await job.send();
    if (result.ok) {
      console.log("✓");
      passed++;
    } else {
      console.log(`✗  (${result.error ?? "unknown error"})`);
      failed++;
    }
    // Brief pause to stay well within Resend's 10 req/s limit
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`  ${passed} sent  /  ${failed} failed`);
  console.log("──────────────────────────────────────────────\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
