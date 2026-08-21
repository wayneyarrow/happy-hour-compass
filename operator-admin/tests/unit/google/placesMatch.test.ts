import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractStreetNumberCandidates,
  streetNumberMatches,
  nameSimilarityOk,
  cityMatches,
  provinceMatches,
  passesConfidenceGate,
  toVenueGoogleFields,
  extractGoogleRatingFields,
  type GoogleMatch,
} from "../../../src/lib/google/placesMatch";

// ── Fixtures ─────────────────────────────────────────────────────────────────
//
// The Perch Sky Lounge candidate below is the REAL Google Places (New)
// searchText result captured during the investigation (2026-08-21), for the
// exact query the app runs at submission time: "Perch Sky Lounge, Kelowna,
// BC". This is what proved Gate 4's original leading-number extraction
// ("701 - 460 Doyle Ave" -> "701") rejected an otherwise-perfect match.

function makeCandidate(overrides: Partial<GoogleMatch> = {}): GoogleMatch {
  return {
    placeId: "ChIJudU-mKf0fVMR4I83exkVEP8",
    name: "Perch Sky Lounge",
    formattedAddress: "460 Doyle Ave #701, Kelowna, BC V1Y 0C2, Canada",
    streetAddress: "460 Doyle Ave",
    city: "Kelowna",
    province: "British Columbia",
    provinceShort: "BC",
    postalCode: "V1Y 0C2",
    country: "Canada",
    lat: 49.8890989,
    lng: -119.4940332,
    phone: "+1 778-594-3562",
    website: "http://www.perchskylounge.com/",
    rating: 4.3,
    reviewCount: 443,
    photoReference: null,
    ...overrides,
  };
}

// ── Part 2 / Part 10.3: Perch-style unit-first address regression ────────────

test("extractStreetNumberCandidates: spaced hyphen unit-first format extracts both unit and street number", () => {
  assert.deepEqual(extractStreetNumberCandidates("701 - 460 Doyle Ave"), ["701", "460"]);
});

test("extractStreetNumberCandidates: bare hyphen unit-first format", () => {
  assert.deepEqual(extractStreetNumberCandidates("701-460 Doyle Ave"), ["701", "460"]);
});

test("extractStreetNumberCandidates: 'Unit N, ' prefix — string starts with a word, so the only candidate is the number after the prefix", () => {
  assert.deepEqual(extractStreetNumberCandidates("Unit 701, 460 Doyle Ave"), ["460"]);
});

test("extractStreetNumberCandidates: 'Suite N, ' prefix — string starts with a word, so the only candidate is the number after the prefix", () => {
  assert.deepEqual(extractStreetNumberCandidates("Suite 701, 460 Doyle Ave"), ["460"]);
});

test("extractStreetNumberCandidates: '#N, ' prefix — string starts with '#', so the only candidate is the number after the prefix", () => {
  assert.deepEqual(extractStreetNumberCandidates("#701, 460 Doyle Ave"), ["460"]);
});

test("streetNumberMatches: Perch-style '701 - 460 Doyle Ave' correctly matches Google street number 460", () => {
  assert.equal(streetNumberMatches("701 - 460 Doyle Ave", "460 Doyle Ave"), true);
});

test("streetNumberMatches: 'Suite 701, 460 Doyle Ave' correctly matches Google street number 460", () => {
  assert.equal(streetNumberMatches("Suite 701, 460 Doyle Ave", "460 Doyle Ave"), true);
});

test("passesConfidenceGate: full Perch Sky Lounge scenario (name/city/province exact, unit-first address) now passes", () => {
  const candidate = makeCandidate();
  const result = passesConfidenceGate(
    {
      businessName: "Perch Sky Lounge",
      streetAddress: "701 - 460 Doyle Ave",
      city: "Kelowna",
      province: "BC",
    },
    candidate
  );
  assert.equal(result, true);
});

// ── Part 10.4: ordinary addresses continue to work unchanged ─────────────────

test("extractStreetNumberCandidates: ordinary address produces exactly one candidate (unchanged behaviour)", () => {
  assert.deepEqual(extractStreetNumberCandidates("123 Main St"), ["123"]);
});

test("streetNumberMatches: ordinary matching addresses still pass", () => {
  assert.equal(streetNumberMatches("123 Main St", "123 Main Street"), true);
});

test("streetNumberMatches: no number submitted still skips the check (unchanged behaviour)", () => {
  assert.equal(streetNumberMatches("Main Street Mall, Unit 5", "123 Main Street"), true);
});

test("streetNumberMatches: no number on the Google side still skips the check (unchanged behaviour)", () => {
  assert.equal(streetNumberMatches("123 Main St", null), true);
});

test("passesConfidenceGate: ordinary confirmed submission (Bar Travelling Man shape) passes", () => {
  const candidate = makeCandidate({
    placeId: "ChIJ216240KNfVMRnxoez_SEV20",
    name: "Bar Travelling Man eatery & cocktails",
    streetAddress: "243 Bernard Avenue",
    city: "Kelowna",
    province: "British Columbia",
    provinceShort: "BC",
    rating: 5,
    reviewCount: 134,
  });
  const result = passesConfidenceGate(
    {
      businessName: "Bar Travelling Man",
      streetAddress: "243 Bernard Avenue",
      city: "Kelowna",
      province: "BC",
    },
    candidate
  );
  assert.equal(result, true);
});

// ── Part 10.5: wrong street-number safety is preserved ────────────────────────

test("streetNumberMatches: clearly different street numbers still fail (ordinary address)", () => {
  assert.equal(streetNumberMatches("123 Main St", "456 Main St"), false);
});

test("streetNumberMatches: unit-first address with a WRONG street number still fails — not every number in the string passes", () => {
  // "701 - 999 Doyle Ave" -> candidates ["701", "999"]; neither matches "460".
  assert.equal(streetNumberMatches("701 - 999 Doyle Ave", "460 Doyle Ave"), false);
});

test("passesConfidenceGate: name mismatch still fails even with a perfect address", () => {
  const candidate = makeCandidate({ name: "Totally Different Bar" });
  const result = passesConfidenceGate(
    {
      businessName: "Perch Sky Lounge",
      streetAddress: "701 - 460 Doyle Ave",
      city: "Kelowna",
      province: "BC",
    },
    candidate
  );
  assert.equal(result, false);
});

test("passesConfidenceGate: city mismatch still fails", () => {
  const candidate = makeCandidate({ city: "Vernon" });
  const result = passesConfidenceGate(
    {
      businessName: "Perch Sky Lounge",
      streetAddress: "701 - 460 Doyle Ave",
      city: "Kelowna",
      province: "BC",
    },
    candidate
  );
  assert.equal(result, false);
});

// ── Gate 1-3 spot checks (pre-existing behaviour, unchanged) ──────────────────

test("nameSimilarityOk: requires at least 60% token overlap", () => {
  assert.equal(nameSimilarityOk("Bar Travelling Man", "Bar Travelling Man eatery & cocktails"), true);
  assert.equal(nameSimilarityOk("Bar Travelling Man", "Completely Unrelated Pub"), false);
});

test("cityMatches: case-insensitive exact match only", () => {
  assert.equal(cityMatches("kelowna", "Kelowna"), true);
  assert.equal(cityMatches("North Vancouver", "Vancouver"), false);
});

test("provinceMatches: accepts both abbreviation and full name", () => {
  assert.equal(provinceMatches("BC", "British Columbia", "BC"), true);
  assert.equal(provinceMatches("British Columbia", "British Columbia", "BC"), true);
  assert.equal(provinceMatches("AB", "British Columbia", "BC"), false);
});

// ── Part 1: canonical venue-field mapping (rating/reviewCount persistence) ───

test("toVenueGoogleFields: maps place_id/rating/reviewCount and marks matched — proves the auto-approval persistence fix", () => {
  const candidate = makeCandidate({
    placeId: "ChIJ216240KNfVMRnxoez_SEV20",
    rating: 5,
    reviewCount: 134,
  });
  assert.deepEqual(toVenueGoogleFields(candidate), {
    place_id: "ChIJ216240KNfVMRnxoez_SEV20",
    google_rating: 5,
    google_review_count: 134,
    google_identity_status: "matched",
  });
});

test("toVenueGoogleFields: null rating/reviewCount are preserved as null, not dropped or coerced", () => {
  const candidate = makeCandidate({ rating: null, reviewCount: null });
  const fields = toVenueGoogleFields(candidate);
  assert.equal(fields.google_rating, null);
  assert.equal(fields.google_review_count, null);
  assert.equal(fields.google_identity_status, "matched");
});

test("extractGoogleRatingFields: extracts rating/reviewCount from a raw google_match_json-shaped blob — proves the manual-approval persistence fix", () => {
  const raw = { rating: 4.3, reviewCount: 443, name: "Perch Sky Lounge" };
  assert.deepEqual(extractGoogleRatingFields(raw), {
    google_rating: 4.3,
    google_review_count: 443,
  });
});

test("extractGoogleRatingFields: null input returns null fields, never throws", () => {
  assert.deepEqual(extractGoogleRatingFields(null), { google_rating: null, google_review_count: null });
  assert.deepEqual(extractGoogleRatingFields(undefined), { google_rating: null, google_review_count: null });
});

test("extractGoogleRatingFields: non-numeric rating/reviewCount are treated as absent, not coerced", () => {
  const raw = { rating: "5", reviewCount: "134" };
  assert.deepEqual(extractGoogleRatingFields(raw), { google_rating: null, google_review_count: null });
});
