import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static wiring proof for the post-expiry final follow-up actions: the
 * network-reachable "use server" module exposes only fixed-signature
 * wrappers (no dependency-injection seam), the impl module is not a server
 * action, and the pages render the Final follow-up panel only through the
 * shared predicate.
 */

const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const ACTIONS = read("src/lib/activation/finalSetupFollowUpActions.ts");
const ACTIONS_CODE = stripComments(ACTIONS);
const IMPL = read("src/lib/activation/finalSetupFollowUpImpl.ts");

test("the \"use server\" module exports exactly four fixed-signature wrappers and passes no deps", () => {
  assert.match(ACTIONS, /^"use server";/);
  const exported = [...ACTIONS_CODE.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, [
    "generateClaimFinalSetupLinkAction",
    "generateSubmissionFinalSetupLinkAction",
    "sendClaimFinalSetupEmailAction",
    "sendSubmissionFinalSetupEmailAction",
  ]);
  assert.match(ACTIONS_CODE, /sendClaimFinalSetupEmailAction\(\s*claimId: string,\s*_prevState: FinalSetupEmailState,\s*_formData: FormData\s*\)/);
  assert.match(ACTIONS_CODE, /generateClaimFinalSetupLinkAction\(claimId: string\)/);
  assert.match(ACTIONS_CODE, /return sendFinalSetupEmailImpl\(\{ type: "claim", claimId \}\);/);
  assert.match(ACTIONS_CODE, /return generateFinalSetupLinkImpl\(\{ type: "submission", submissionId \}\);/);
  assert.doesNotMatch(ACTIONS_CODE, /\bdeps\b|FinalSetupFollowUpDeps|checkAdmin|adminClient/);
});

test("the impl module is not a server action and authorizes before any lookup", () => {
  assert.doesNotMatch(IMPL, /"use server";/);
  const code = stripComments(IMPL);
  const authAt = code.indexOf("checkAdmin(user.email)");
  const firstLookup = code.indexOf("resolveFollowUpContext(admin, origin, now)");
  assert.ok(authAt > 0 && firstLookup > authAt, "authorization precedes the first lifecycle read");
});

test("the impl never uses Supabase's raw action_link, never logs the link, and builds the scanner-safe token_hash shape", () => {
  const code = stripComments(IMPL);
  assert.doesNotMatch(code, /action_link/);
  assert.match(code, /buildTokenHashRecoveryLink\(redirectTo, hashedToken\)\}&intent=setup/);
  // The `link` / `setupLink` values are never passed as an argument or
  // object property to console logging (prose mentioning "link" is fine).
  assert.doesNotMatch(code, /console\.\w+\([^;]*[,{(]\s*(link|setupLink|hashedToken)\s*[,})]/, "the link/token is never logged");
});

test("both detail pages render the Final follow-up panel through shouldShowFinalFollowUpPanel", () => {
  for (const page of ["src/app/control-panel/claims/[id]/page.tsx", "src/app/control-panel/operator-submissions/[id]/page.tsx"]) {
    const src = read(page);
    assert.match(src, /shouldShowFinalFollowUpPanel\(/, page);
    assert.match(src, /<FinalSetupFollowUpPanel/, page);
  }
});

test("the panel shows the agreed button label and description", () => {
  const panel = read("src/components/FinalSetupFollowUpPanel.tsx");
  assert.match(panel, /"Final resend setup email"/);
  assert.match(
    panel.replace(/\s+/g, " "),
    /Sends a fresh setup email for your final personal follow-up\. Automatic reminders remain stopped, and the setup window is not extended\./
  );
  assert.match(panel, /"Copy setup link"/);
});

test("account activation can never re-verify or re-own a released venue: the only venue write at activation is scoped to venues the operator still owns", () => {
  const src = read("src/lib/operatorActivation.ts");
  const start = src.indexOf("export async function completeOperatorAccountActivation(");
  const body = src.slice(start);
  const venueWrites = [...body.matchAll(/\.from\("venues"\)\s*\.update\(/g)];
  assert.equal(venueWrites.length, 1, "exactly one venue UPDATE in activation completion");
  const writeBlock = body.slice(venueWrites[0].index!, venueWrites[0].index! + 300);
  assert.match(writeBlock, /\.update\(\{ is_verified: true \}\)/);
  assert.match(writeBlock, /\.eq\("created_by_operator_id", operatorId\)/, "scoped to current ownership — Release cleared it");
  assert.doesNotMatch(body.slice(0, body.indexOf("\nexport ") > 0 ? body.indexOf("\nexport ") : undefined), /created_by_operator_id:\s/, "activation never assigns ownership");
});
