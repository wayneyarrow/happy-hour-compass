import "../integration/support/installBoundaryFakes";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { world, resetWorld, fakeAdminClient } from "../integration/support/world";
import {
  gatherClaimSignals,
  haversineKm,
  meaningfulWebsiteDomain,
  phoneLast10,
  readTrustedGeo,
  type ClaimSignalInput,
} from "../../../src/lib/claims/claimAutoApprovalSignals";
import { evaluateClaimAutoApproval } from "../../../src/lib/claims/claimAutoApprovalPolicy";

/** Signal gathering: normalization helpers + the real gatherer against the in-process world. */

beforeEach(() => {
  resetWorld();
  process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED = "true";
  process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET = "fixture-hmac-secret-that-is-at-least-32-characters";
  process.env.CLAIM_AUTO_APPROVAL_ENABLED = "true";
});

test("phoneLast10: formatting and a leading +1 never cause a false mismatch", () => {
  assert.equal(phoneLast10("(250) 555-0100"), "2505550100");
  assert.equal(phoneLast10("+1 250-555-0100"), "2505550100");
  assert.equal(phoneLast10("12505550100"), "2505550100");
  assert.equal(phoneLast10("(250) 555-0100 ext. 9"), "2505550100", "a trailing extension is ignored");
  assert.equal(phoneLast10("250-555-0100 x12"), "2505550100");
  assert.equal(phoneLast10("555-0100"), null, "too short to compare → unknown");
  assert.equal(phoneLast10(null), null);
});

test("meaningfulWebsiteDomain: strips www; platform/service hosts are not ownership domains", () => {
  assert.equal(meaningfulWebsiteDomain("https://www.fixturetaproom.test/menu"), "fixturetaproom.test");
  for (const url of ["https://www.facebook.com/fixture", "https://linktr.ee/fixture", "fixture.square.site", "https://www.toasttab.com/fixture", "https://sites.google.com/view/x"]) {
    assert.equal(meaningfulWebsiteDomain(url), null, url);
  }
  assert.equal(meaningfulWebsiteDomain(null), null);
});

test("readTrustedGeo: only trusted on Vercel; malformed values are ignored; city is decoded", () => {
  const h = new Headers({
    "x-vercel-ip-country": "CA",
    "x-vercel-ip-country-region": "BC",
    "x-vercel-ip-city": "Qu%C3%A9bec",
    "x-vercel-ip-latitude": "49.28",
    "x-vercel-ip-longitude": "-123.12",
  });
  assert.equal(readTrustedGeo(h, false).resolved, false, "off Vercel a client could send these headers");
  const g = readTrustedGeo(h, true);
  assert.deepEqual(g, { resolved: true, countryCode: "ca", region: "BC", city: "Québec", lat: 49.28, lng: -123.12 });
  assert.equal(readTrustedGeo(new Headers({ "x-vercel-ip-country": "not-a-country" }), true).resolved, false);
  assert.equal(readTrustedGeo(new Headers(), true).resolved, false, "missing → unknown (neutral)");
});

test("haversineKm: Kelowna ↔ Vancouver is a remote-domestic distance, not 'far' enough on its own", () => {
  const km = haversineKm(49.888, -119.496, 49.28, -123.12);
  assert.ok(km > 250 && km < 300, String(km));
});

function input(overrides: Partial<ClaimSignalInput["claim"]> = {}): ClaimSignalInput {
  return {
    claim: { id: "c-this", email: "Casey@Gmail.com", phone: "(250) 555-0199", position: "Manager", ipAddress: "203.0.113.9", ...overrides },
    venue: { id: "v-1", name: "Fixture Taproom", country: "Canada", lat: 49.888, lng: -119.496, phone: "250-555-0100", websiteUrl: "https://fixturetaproom.test", claimedAt: null, claimedBy: null, createdByOperatorId: null },
    requestHeaders: new Headers({ "x-vercel-ip-country": "US", "x-vercel-ip-latitude": "47.6", "x-vercel-ip-longitude": "-122.3" }),
  };
}

test("gather: normalizes email, phone, domain and geo into the policy's shape", async () => {
  world.tables.venue_claims.push({ id: "c-this", venue_id: "v-1", status: "pending", email: "casey@gmail.com", ip_address: "203.0.113.9" });
  const s = await gatherClaimSignals(input(), { admin: fakeAdminClient() as never, trustGeoHeaders: true });
  assert.equal(s.claimant.email, "casey@gmail.com");
  assert.equal(s.claimant.isPublicEmailDomain, true);
  assert.equal(s.venue.phoneLast10, "2505550100");
  assert.equal(s.claimant.phoneLast10, "2505550199");
  assert.equal(s.venue.websiteDomain, "fixturetaproom.test");
  assert.equal(s.geo.ipCountryCode, "us");
  assert.equal(s.geo.venueCountryCode, "ca");
  assert.equal(s.velocity.emailClaims24h, 1, "counts this claim");
  assert.equal(s.velocity.ipClaims24h, 1);
  assert.equal(s.infrastructure.emailCodeAvailable, true);
  assert.equal(s.infrastructure.signalReadFailed, false);
});

test("gather: velocity counts only the last 24h, and the 4th claim is the one that triggers review", async () => {
  const old = new Date(Date.now() - 25 * 3600_000).toISOString();
  world.tables.venue_claims.push(
    { id: "old", venue_id: "v-x", status: "rejected", email: "casey@gmail.com", created_at: old },
    { id: "a", venue_id: "v-a", status: "pending", email: "casey@gmail.com" },
    { id: "b", venue_id: "v-b", status: "pending", email: "casey@gmail.com" },
    { id: "c-this", venue_id: "v-1", status: "pending", email: "casey@gmail.com" }
  );
  const third = await gatherClaimSignals(input({ ipAddress: null }), { admin: fakeAdminClient() as never, trustGeoHeaders: false });
  assert.equal(third.velocity.emailClaims24h, 3);
  assert.equal(evaluateClaimAutoApproval(third).decision, "auto_approved");
  world.tables.venue_claims.push({ id: "d", venue_id: "v-d", status: "pending", email: "casey@gmail.com" });
  const fourth = await gatherClaimSignals(input({ ipAddress: null }), { admin: fakeAdminClient() as never, trustGeoHeaders: false });
  assert.equal(evaluateClaimAutoApproval(fourth).hardReasons[0].code, "H6_claim_velocity");
});

test("gather: a failed safety read never auto-approves blind (technical H7)", async () => {
  const admin = fakeAdminClient();
  const failing = { ...admin, from: (t: string) => (t === "operator_submissions" ? { select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "db down" } }) }) }) } : admin.from(t)) };
  const s = await gatherClaimSignals(input(), { admin: failing as never, trustGeoHeaders: false });
  assert.equal(s.infrastructure.signalReadFailed, true);
  const d = evaluateClaimAutoApproval(s);
  assert.equal(d.decision, "founder_review");
  assert.equal(d.technicalFallbackOnly, true);
});

test("gather: team-member and admin logins are recognized as non-operator accounts (H5)", async () => {
  world.tables.operator_memberships = [{ id: "m1", email: "casey@gmail.com" }];
  const s = await gatherClaimSignals(input(), { admin: fakeAdminClient() as never });
  assert.equal(s.conflicts.nonOperatorAccountKind, "team_member");
  world.tables.platform_admins = [{ id: "p1", email: "casey@gmail.com" }];
  const s2 = await gatherClaimSignals(input(), { admin: fakeAdminClient() as never });
  assert.equal(s2.conflicts.nonOperatorAccountKind, "platform_admin");
});
