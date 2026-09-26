import "../integration/support/installBoundaryFakes";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetWorld, world, fakeAdminClient } from "../integration/support/world";
import { formatPhoneForDisplay } from "../../../src/lib/claims/phoneDisplay";
import { autoApprovedNoteText, autoDecisionMetadata, supportingWithoutRole } from "../../../src/lib/claims/claimAutoDecisionRecord";
import { buildAutoApprovedClaimNotification } from "../../../src/lib/claims/claimAutoApprovalNotifications";
import { evaluateClaimAutoApproval, type ClaimSignals } from "../../../src/lib/claims/claimAutoApprovalPolicy";
import { gatherClaimSignals } from "../../../src/lib/claims/claimAutoApprovalSignals";

beforeEach(() => {
  resetWorld();
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.fixture.example";
  process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED = "true";
  process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET = "fixture-hmac-secret-that-is-at-least-32-characters";
  process.env.CLAIM_AUTO_APPROVAL_ENABLED = "true";
});

test("formatPhoneForDisplay: NANP 10/11-digit numbers render consistently; anything else is left as entered", () => {
  assert.equal(formatPhoneForDisplay("2507663408"), "(250) 766-3408");
  assert.equal(formatPhoneForDisplay("250-766-3408"), "(250) 766-3408");
  assert.equal(formatPhoneForDisplay("(604) 812-8799"), "(604) 812-8799");
  assert.equal(formatPhoneForDisplay("+1 250 766 3408"), "(250) 766-3408");
  assert.equal(formatPhoneForDisplay("12507663408"), "(250) 766-3408");
  assert.equal(formatPhoneForDisplay("250-766-3408 ext. 4"), "250-766-3408 ext. 4", "extensions untouched");
  assert.equal(formatPhoneForDisplay("+44 20 7946 0958"), "+44 20 7946 0958", "no international normalization");
  assert.equal(formatPhoneForDisplay("555-0100"), "555-0100");
  assert.equal(formatPhoneForDisplay("  "), null);
  assert.equal(formatPhoneForDisplay(null), null);
});

test("signals: display phones are formatted, comparison still uses digits; stored values untouched; decision unchanged", async () => {
  const venue = { id: "v-1", name: "BLOCK-style Venue", country: "Canada", lat: 50.13, lng: -119.45, phone: "2507663408", websiteUrl: null, claimedAt: null, claimedBy: null, createdByOperatorId: null };
  world.tables.venue_claims.push({ id: "c-1", venue_id: "v-1", status: "pending", email: "x@gmail.com" });
  const s = await gatherClaimSignals(
    { claim: { id: "c-1", email: "x@gmail.com", phone: "(604) 812-8799", position: "Manager", ipAddress: null }, venue, requestHeaders: new Headers() },
    { admin: fakeAdminClient() as never, trustGeoHeaders: false }
  );
  assert.equal(s.venue.phone, "(250) 766-3408");
  assert.equal(s.venue.phoneLast10, "2507663408");
  assert.equal(venue.phone, "2507663408", "input not mutated");
  const d = evaluateClaimAutoApproval(s);
  assert.equal(d.decision, "auto_approved");
  assert.equal(d.cautions[0].explanation, "Claim phone (604) 812-8799 does not match the venue phone (250) 766-3408.");

  // A differently-formatted SAME number is still a match (P2), exactly as before.
  const same = await gatherClaimSignals(
    { claim: { id: "c-1", email: "x@gmail.com", phone: "+1 250.766.3408", position: "Manager", ipAddress: null }, venue, requestHeaders: new Headers() },
    { admin: fakeAdminClient() as never, trustGeoHeaders: false }
  );
  assert.equal(evaluateClaimAutoApproval(same).positives[0].code, "P2_phone_match");
});

function signals(over: Partial<ClaimSignals["claimant"]> = {}, geo: Partial<ClaimSignals["geo"]> = {}): ClaimSignals {
  return {
    infrastructure: { autoApprovalEnabled: true, emailCodeAvailable: true, incompatibleLegacyLifecycle: false, signalReadFailed: false },
    venue: { name: "Fixture Bar", country: "Canada", websiteDomain: null, phone: "(250) 766-3408", phoneLast10: "2507663408" },
    claimant: { email: "a@gmail.com", emailDomain: "gmail.com", isPublicEmailDomain: true, phone: "(604) 812-8799", phoneLast10: "6048128799", role: "Manager", ...over },
    conflicts: { competingOpenClaimStatus: null, competingOpenSubmissionStatus: null, inconsistentOwnership: false, priorRejectionSameEmail: false, priorRejectionOtherEmail: false, nonOperatorAccountKind: null },
    velocity: { emailClaims24h: 1, ipClaims24h: 1 },
    geo: { resolved: true, country: "CA", region: "BC", city: "Kelowna", ipCountryCode: "ca", venueCountryCode: "ca", distanceKm: 27.6, ...geo },
    existingOperator: { exists: false, activated: false },
  };
}

test("note text: BLOCK ONE-style case reads as one coherent sentence set, role once, no codes", () => {
  const d = evaluateClaimAutoApproval(signals());
  const text = autoApprovedNoteText(d, { role: "Manager", returningOperator: false });
  assert.equal(
    text,
    "Claim auto-approved — no founder review needed. No conflicts, and no combination of concerns that needs review. " +
      "Also noted: Claim phone (604) 812-8799 does not match the venue phone (250) 766-3408. " +
      "Supporting context: Claim came from near the venue (~28 km, Kelowna, BC). Role entered: Manager. " +
      "Operator account created; setup continues with email-code verification."
  );
  assert.doesNotMatch(text, /\b[HCPR]\d/);
});

test("note text: no cautions/supporting → no empty sections; returning operator tail; role stated once when uncovered", () => {
  const d = evaluateClaimAutoApproval(signals({ phoneLast10: null, phone: null, role: "Owner" }, { resolved: false, distanceKm: null }));
  const t = autoApprovedNoteText(d, { role: "Owner", returningOperator: true });
  assert.doesNotMatch(t, /Also noted/);
  assert.match(t, /Supporting context: Role entered: Owner\. Existing activated operator: venue added to their account\.$/);
  const synthetic = { ...d, supporting: [], cautions: [] };
  assert.match(autoApprovedNoteText(synthetic, { role: "Owner", returningOperator: false }), / Role entered: Owner\. Operator account created/);
});

test("metadata: codes + readable explanations + city-level geo only; unresolved geo stores no geo block", () => {
  const d = evaluateClaimAutoApproval(signals());
  const m = autoDecisionMetadata(d, signals().geo, { returningOperator: false });
  assert.deepEqual(m.cautions, ["C5_phone_mismatch"]);
  assert.deepEqual(m.supporting, ["P4_local_ip", "P5_owner_or_manager"]);
  assert.deepEqual(m.geo, { country: "CA", region: "BC", city: "Kelowna", distanceKm: 28 });
  assert.equal(m.returningOperator, false);
  assert.deepEqual((m.explanations as Record<string, string[]>).positives, []);
  const unresolved = signals({}, { resolved: false, distanceKm: null, city: null, region: null, country: null });
  assert.equal("geo" in autoDecisionMetadata(evaluateClaimAutoApproval(unresolved), unresolved.geo), false);
});

test("founder notification: role shown once (claimant line); phone rows formatted; C3 role reason stays explicit", () => {
  const d = evaluateClaimAutoApproval(signals());
  assert.deepEqual(supportingWithoutRole(d), ["Claim came from near the venue (~28 km, Kelowna, BC)."]);
  const n = buildAutoApprovedClaimNotification({
    claimId: "c1",
    venueName: "Fixture Bar",
    city: "Lake Country",
    claimant: { firstName: "Casey", lastName: "Claimant", email: "a@gmail.com", phone: "6048128799", role: "Manager" },
    decision: d,
    nextStep: "new_operator_in_flow",
  });
  assert.equal((n.text.match(/Manager/g) ?? []).length, 1);
  assert.equal((n.html.match(/Manager/g) ?? []).length, 1);
  assert.match(n.text, /Phone: {4}\(604\) 812-8799/);
  assert.match(n.slack, /Phone: \(604\) 812-8799/);
  assert.match(n.text, /venue phone \(250\) 766-3408/);
  assert.doesNotMatch(n.text + n.slack + n.html, /\b[HCPR]\d_/);

  // A Bartender claim that still auto-approves: the role caution is kept, explicitly.
  const bartender = evaluateClaimAutoApproval(signals({ role: "Bartender" }));
  assert.equal(bartender.decision, "auto_approved");
  const nb = buildAutoApprovedClaimNotification({
    claimId: "c2", venueName: "Fixture Bar", city: null,
    claimant: { firstName: "B", lastName: "T", email: "b@gmail.com", phone: "1", role: "Bartender" },
    decision: bartender, nextStep: "new_operator_in_flow",
  });
  assert.match(nb.text, /Also noted \(not enough to require review\):\n• Role entered: Bartender\.\n• Claim phone /);
});
