import "../integration/support/installBoundaryFakes";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { world, resetWorld } from "../integration/support/world";
import { buildAutoApprovedClaimNotification } from "../../../src/lib/claims/claimAutoApprovalNotifications";
import { evaluateClaimAutoApproval, type ClaimSignals } from "../../../src/lib/claims/claimAutoApprovalPolicy";
import { getRelatedClaimNotesForVenue } from "../../../src/lib/data/venueNotes";

beforeEach(() => {
  resetWorld();
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.fixture.example";
});

function signals(): ClaimSignals {
  return {
    infrastructure: { autoApprovalEnabled: true, emailCodeAvailable: true, incompatibleLegacyLifecycle: false, signalReadFailed: false },
    venue: { name: "Fixture Bar", country: "Canada", websiteDomain: "fixturebar.test", phone: "(250) 555-0100", phoneLast10: "2505550100" },
    claimant: { email: "gm@fixturebar.test", emailDomain: "fixturebar.test", isPublicEmailDomain: false, phone: "(250) 555-0199", phoneLast10: "2505550199", role: "Owner" },
    conflicts: { competingOpenClaimStatus: null, competingOpenSubmissionStatus: null, inconsistentOwnership: false, priorRejectionSameEmail: false, priorRejectionOtherEmail: false, nonOperatorAccountKind: null },
    velocity: { emailClaims24h: 1, ipClaims24h: 1 },
    geo: { resolved: true, country: "CA", region: "BC", city: "Kelowna", ipCountryCode: "ca", venueCountryCode: "ca", distanceKm: 4 },
    existingOperator: { exists: false, activated: false },
  };
}

test("AUTO-APPROVED notification: unmistakable label, venue, claimant, plain-English basis, next step — no reason codes", () => {
  const decision = evaluateClaimAutoApproval(signals());
  const n = buildAutoApprovedClaimNotification({
    claimId: "c1",
    venueName: "Fixture Bar",
    city: "Kelowna",
    claimant: { firstName: "Alex", lastName: "Owner", email: "gm@fixturebar.test", phone: "(250) 555-0199", role: "Owner" },
    decision,
    nextStep: "new_operator_in_flow",
    activationDeadline: "2026-10-10T00:00:00.000Z",
  });
  assert.equal(n.subject, "[CLAIM AUTO-APPROVED] Fixture Bar (Kelowna)");
  for (const body of [n.text, n.slack]) {
    assert.match(body, /CLAIM AUTO-APPROVED/);
    assert.match(body, /Alex Owner/);
    assert.match(body, /gm@fixturebar\.test/);
    assert.match(body, /Business email domain fixturebar\.test matches the venue website \(fixturebar\.test\)\./);
    assert.match(body, /Claim phone \(250\) 555-0199 does not match the venue phone \(250\) 555-0100\./, "cautions are still shown");
    assert.match(body, /verifying their email in HHC now/);
    assert.doesNotMatch(body, /\b[HCPR]\d\b|_(match|ip|role)/, "no internal codes");
  }
  assert.match(n.text, /Supporting context:\n• Claim came from near the venue \(~4 km, Kelowna, BC\)\.\n\nNext step:/, "role is not repeated as supporting context");
  assert.equal((n.text.match(/Owner/g) ?? []).length, 2, "role shown once in the claimant line (+ the name 'Alex Owner')");
  assert.match(n.html, /CLAIM AUTO-APPROVED/);
  assert.match(n.html, /\/control-panel\/claims\/c1/);
});

test("AUTO-APPROVED notification escapes claimant-controlled text in HTML", () => {
  const n = buildAutoApprovedClaimNotification({
    claimId: "c1",
    venueName: "Bar <b>",
    city: null,
    claimant: { firstName: "<img src=x>", lastName: "Y", email: "a@b.test", phone: "1", role: "Owner" },
    decision: evaluateClaimAutoApproval(signals()),
    nextStep: "returning_operator",
  });
  assert.ok(!n.html.includes("<img src=x>"));
  assert.ok(!n.html.includes("Bar <b>"));
  assert.match(n.text, /Existing activated operator/);
});

test("Venue Internal Notes: activation's duplicate note pair shows once; expiry/release history still surfaces", async () => {
  world.tables.venue_claims.push({ id: "c1", venue_id: "v1" }, { id: "c2", venue_id: "v1" });
  const note = (claimId: string, text: string, eventType: string | null) =>
    world.tables.venue_claim_notes.push({ id: `${claimId}-${world.tables.venue_claim_notes.length}`, claim_id: claimId, note: text, event_type: eventType, created_at: new Date(Date.now() + world.tables.venue_claim_notes.length).toISOString() });
  note("c1", "Operator account setup completed — Alex can now sign in.", null);
  note("c1", "Operator account setup completed — Alex can now sign in.", "account_activated");
  note("c1", "Activation window expired.", "activation_expired");
  note("c1", "Venue released by founder.", "founder_manual_release");
  note("c2", "Operator account setup completed — Alex can now sign in.", null); // a different claim: not a duplicate

  const { notes } = await getRelatedClaimNotesForVenue("v1");
  const texts = notes.map((n) => n.note);
  assert.equal(texts.filter((t) => t.endsWith("Alex can now sign in.")).length, 2, "one per claim");
  assert.ok(texts.includes("(via venue claim) Activation window expired."));
  assert.ok(texts.includes("(via venue claim) Venue released by founder."));
  assert.equal(world.tables.venue_claim_notes.length, 5, "display-only: nothing deleted");
});
