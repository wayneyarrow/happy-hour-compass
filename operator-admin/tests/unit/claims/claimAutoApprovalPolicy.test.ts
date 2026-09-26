import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateClaimAutoApproval,
  type ClaimSignals,
} from "../../../src/lib/claims/claimAutoApprovalPolicy";

/**
 * Exhaustive decision matrix for the pure claim auto-approval policy.
 * Case numbers match the task's required matrix (1–26).
 */

type Overrides = {
  infrastructure?: Partial<ClaimSignals["infrastructure"]>;
  venue?: Partial<ClaimSignals["venue"]>;
  claimant?: Partial<ClaimSignals["claimant"]>;
  conflicts?: Partial<ClaimSignals["conflicts"]>;
  velocity?: Partial<ClaimSignals["velocity"]>;
  geo?: Partial<ClaimSignals["geo"]>;
  existingOperator?: Partial<ClaimSignals["existingOperator"]>;
};

/** A plain, ordinary claim: Gmail, Manager, no phone on either side, geo unresolved, no conflicts. */
function signals(o: Overrides = {}): ClaimSignals {
  return {
    infrastructure: { autoApprovalEnabled: true, emailCodeAvailable: true, incompatibleLegacyLifecycle: false, signalReadFailed: false, ...o.infrastructure },
    venue: { name: "Fixture Bar", country: "Canada", websiteDomain: "fixturebar.ca", phone: null, phoneLast10: null, ...o.venue },
    claimant: {
      email: "owner@gmail.com",
      emailDomain: "gmail.com",
      isPublicEmailDomain: true,
      phone: null,
      phoneLast10: null,
      role: "Manager",
      ...o.claimant,
    },
    conflicts: {
      competingOpenClaimStatus: null,
      competingOpenSubmissionStatus: null,
      inconsistentOwnership: false,
      priorRejectionSameEmail: false,
      priorRejectionOtherEmail: false,
      nonOperatorAccountKind: null,
      ...o.conflicts,
    },
    velocity: { emailClaims24h: 1, ipClaims24h: 1, ...o.velocity },
    geo: { resolved: false, country: null, region: null, city: null, ipCountryCode: null, venueCountryCode: "ca", distanceKm: null, ...o.geo },
    existingOperator: { exists: false, activated: false, ...o.existingOperator },
  };
}

const venuePhone = { phone: "(250) 555-0100", phoneLast10: "2505550100" };
const mismatchPhone = { phone: "(250) 555-0199", phoneLast10: "2505550199" };
const domestic = (km: number) => ({ resolved: true, country: "CA", region: "BC", city: "Vancouver", ipCountryCode: "ca", venueCountryCode: "ca", distanceKm: km });
const foreign = { resolved: true, country: "US", region: "WA", city: "Seattle", ipCountryCode: "us", venueCountryCode: "ca", distanceKm: 380 };
const businessMatch = { email: "gm@fixturebar.ca", emailDomain: "fixturebar.ca", isPublicEmailDomain: false };
const businessOther = { email: "ops@otherco.com", emailDomain: "otherco.com", isPublicEmailDomain: false };

function expectAuto(s: ClaimSignals, rule?: string) {
  const d = evaluateClaimAutoApproval(s);
  assert.equal(d.decision, "auto_approved", JSON.stringify({ rule: d.rule, hard: d.hardReasons, cautions: d.cautions }));
  if (rule) assert.equal(d.rule, rule);
  return d;
}
function expectReview(s: ClaimSignals, rule: string) {
  const d = evaluateClaimAutoApproval(s);
  assert.equal(d.decision, "founder_review");
  assert.equal(d.rule, rule);
  assert.ok(d.humanReasons.length > 0, "every review decision explains itself");
  for (const r of d.humanReasons) assert.doesNotMatch(r, /\b[HCPR]\d\b|_/, "human reasons are plain English, not codes");
  return d;
}

// ── AUTO-APPROVE ─────────────────────────────────────────────────────────────

test("1. Gmail + Manager + phone mismatch + domestic 300 km IP → auto-approve", () => {
  const d = expectAuto(signals({ venue: venuePhone, claimant: mismatchPhone, geo: domestic(300) }), "default_auto_approve");
  assert.deepEqual(d.cautions.map((c) => c.code), ["C5_phone_mismatch"]);
});

test("2. Gmail + no phone + unresolved geo → auto-approve with no cautions", () => {
  const d = expectAuto(signals(), "default_auto_approve");
  assert.equal(d.cautions.length, 0);
  assert.equal(d.geoResolved, false);
});

test("3. Server + Gmail + local IP → auto-approve", () => {
  const d = expectAuto(signals({ claimant: { role: "Server" }, geo: domestic(8) }), "default_auto_approve");
  assert.deepEqual(d.cautions.map((c) => c.code), ["C3_role"]);
  assert.ok(d.supporting.some((s) => s.code === "P4_local_ip"));
});

test("4. Owner + business-domain match + foreign IP → auto-approve (P1 overrides caution)", () => {
  const d = expectAuto(signals({ claimant: { ...businessMatch, role: "Owner" }, geo: foreign }), "strong_positive");
  assert.deepEqual(d.positives.map((p) => p.code), ["P1_business_domain_match"]);
  assert.deepEqual(d.cautions.map((c) => c.code), ["C1_foreign_ip"]);
});

test("5. Other + foreign IP + phone match → auto-approve (P2 overrides)", () => {
  expectAuto(signals({ venue: venuePhone, claimant: { ...venuePhone, role: "Other" }, geo: foreign }), "strong_positive");
});

test("6. Remote domestic IP only (900 km) → auto-approve", () => {
  const d = expectAuto(signals({ geo: domestic(900) }));
  assert.deepEqual(d.cautions.map((c) => c.code), ["C2_distant_domestic_ip"]);
});

test("7. Phone mismatch only → auto-approve", () => {
  expectAuto(signals({ venue: venuePhone, claimant: mismatchPhone }));
});

test("8. Generic (public) email only → auto-approve, and a public email is never a 'mismatched business domain'", () => {
  const d = expectAuto(signals({ claimant: { email: "a@outlook.com", emailDomain: "outlook.com", isPublicEmailDomain: true } }));
  assert.equal(d.cautions.length, 0);
});

test("9. No positive signals and fewer than the threshold of cautions → auto-approve", () => {
  const d = expectAuto(signals({ venue: venuePhone, claimant: { ...mismatchPhone, role: "Bartender" } }), "default_auto_approve");
  assert.equal(d.cautions.length, 2);
  assert.equal(d.positives.length, 0);
});

// ── MANUAL REVIEW ────────────────────────────────────────────────────────────

test("10. H1 competing open claim → review", () => {
  const d = expectReview(signals({ conflicts: { competingOpenClaimStatus: "needs_more_info" } }), "hard_condition");
  assert.match(d.humanReasons[0], /Another claim for this venue is still open \(status: needs more info\)/);
});
test("11. H2 competing open submission → review", () => {
  expectReview(signals({ conflicts: { competingOpenSubmissionStatus: "pending_review" } }), "hard_condition");
});
test("12. H3 inconsistent ownership → review", () => {
  expectReview(signals({ conflicts: { inconsistentOwnership: true } }), "hard_condition");
});
test("13. H4 same email previously rejected → review", () => {
  const d = expectReview(signals({ conflicts: { priorRejectionSameEmail: true } }), "hard_condition");
  assert.match(d.humanReasons[0], /owner@gmail\.com was rejected/);
});
test("14. H5 consumer (non-operator) account collision → review", () => {
  const d = expectReview(signals({ conflicts: { nonOperatorAccountKind: "consumer" } }), "hard_condition");
  assert.match(d.humanReasons[0], /consumer Happy Hour Compass account/);
});
test("15. H6 fourth claim from the same email in 24h → review; the third is fine", () => {
  expectAuto(signals({ velocity: { emailClaims24h: 3 } }));
  const d = expectReview(signals({ velocity: { emailClaims24h: 4 } }), "hard_condition");
  assert.match(d.humanReasons[0], /4 claims from owner@gmail\.com/);
});
test("16. H6 fourth claim from the same IP in 24h → review; the third is fine", () => {
  expectAuto(signals({ velocity: { ipClaims24h: 3 } }));
  expectReview(signals({ velocity: { ipClaims24h: 4 } }), "hard_condition");
});
test("17. H7 flag disabled → review, flagged as technical fallback only", () => {
  const d = expectReview(signals({ infrastructure: { autoApprovalEnabled: false } }), "hard_condition");
  assert.equal(d.technicalFallbackOnly, true);
  assert.match(d.humanReasons[0], /Automatic approval was unavailable \(claim auto-approval is turned off\)\. No claimant risk signal triggered this review\./);
});
test("18. H7 email-code unavailable → review, technical fallback only", () => {
  const d = expectReview(signals({ infrastructure: { emailCodeAvailable: false } }), "hard_condition");
  assert.equal(d.technicalFallbackOnly, true);
});
test("18b. H7 legacy lifecycle / failed safety read → review, technical fallback only", () => {
  assert.equal(expectReview(signals({ infrastructure: { incompatibleLegacyLifecycle: true } }), "hard_condition").technicalFallbackOnly, true);
  assert.equal(expectReview(signals({ infrastructure: { signalReadFailed: true } }), "hard_condition").technicalFallbackOnly, true);
});
test("19. Foreign IP + one additional caution → review (R1)", () => {
  const d = expectReview(signals({ claimant: { role: "Server" }, geo: foreign }), "R1_foreign_ip_plus_caution");
  assert.equal(d.technicalFallbackOnly, false);
  assert.match(d.humanReasons.join(" "), /IP in Seattle, WA, US; the venue is in Canada/);
  assert.match(d.humanReasons.join(" "), /Role entered: Server/);
});
test("19b. Foreign IP ALONE never forces review", () => {
  expectAuto(signals({ geo: foreign }));
});
test("20. Three C2–C6 cautions → review (R2), with comparison values in the reasons", () => {
  const d = expectReview(
    signals({ venue: venuePhone, claimant: { ...businessOther, ...mismatchPhone, role: "Bartender" }, geo: domestic(700) }),
    "R2_three_cautions"
  );
  const text = d.humanReasons.join(" ");
  assert.match(text, /Claim phone \(250\) 555-0199 does not match the venue phone \(250\) 555-0100/);
  assert.match(text, /Claim email domain otherco\.com does not match the venue website domain fixturebar\.ca/);
  assert.match(text, /about 700 km from the venue/);
});

// ── OVERRIDES ────────────────────────────────────────────────────────────────

const cautionCombo = { venue: venuePhone, claimant: { ...mismatchPhone, role: "Server" }, geo: foreign }; // R1 on its own
test("21. P1 + an ordinary caution combination → auto-approve", () => {
  expectReview(signals(cautionCombo), "R1_foreign_ip_plus_caution");
  expectAuto(signals({ ...cautionCombo, claimant: { ...cautionCombo.claimant, ...businessMatch } }), "strong_positive");
});
test("22. P2 + an ordinary caution combination → auto-approve", () => {
  expectAuto(signals({ ...cautionCombo, claimant: { ...cautionCombo.claimant, ...venuePhone } }), "strong_positive");
});
test("23. P3 activated operator + ordinary cautions → auto-approve", () => {
  const d = expectAuto(signals({ ...cautionCombo, existingOperator: { exists: true, activated: true } }), "strong_positive");
  assert.deepEqual(d.positives.map((p) => p.code), ["P3_existing_activated_operator"]);
});
for (const [label, extra] of [
  ["24. P1", { claimant: businessMatch }],
  ["25. P2", { venue: venuePhone, claimant: venuePhone }],
  ["26. P3", { existingOperator: { exists: true, activated: true } }],
] as const) {
  test(`${label} + a hard condition → review (positives never override H)`, () => {
    const d = expectReview(signals({ ...(extra as Overrides), conflicts: { competingOpenClaimStatus: "info_submitted" } }), "hard_condition");
    assert.ok(d.positives.length > 0, "the positive is still recorded");
  });
}

// ── NEUTRAL ──────────────────────────────────────────────────────────────────

test("neutral: no website, no venue phone, unresolved geo, no positives → auto-approve with zero cautions", () => {
  const d = expectAuto(signals({ venue: { websiteDomain: null, phone: null, phoneLast10: null }, claimant: businessOther }));
  assert.equal(d.cautions.length, 0, "no venue website → a business domain can't 'mismatch'");
});

test("neutral: a prior rejection from ANOTHER email is only a caution (C6), not a hard stop", () => {
  const d = expectAuto(signals({ conflicts: { priorRejectionOtherEmail: true } }));
  assert.deepEqual(d.cautions.map((c) => c.code), ["C6_prior_rejection_other_email"]);
});

test("mixed H7 + risk: not labelled technical-only, and both reasons are listed", () => {
  const d = expectReview(signals({ infrastructure: { autoApprovalEnabled: false }, conflicts: { inconsistentOwnership: true } }), "hard_condition");
  assert.equal(d.technicalFallbackOnly, false);
  assert.equal(d.humanReasons.length, 2);
});
