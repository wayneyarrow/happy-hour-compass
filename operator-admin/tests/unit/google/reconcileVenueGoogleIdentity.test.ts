import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileVenueGoogleIdentity } from "../../../src/lib/google/reconcileVenueGoogleIdentity";
import { createFakeVenuesGoogleIdentityClient } from "./support/fakeVenuesGoogleIdentityClient";

// ── fetch mocking helpers ──────────────────────────────────────────────────────
//
// searchGooglePlace() (src/lib/google/placesMatch.ts) calls the global fetch.
// Rather than adding a test-only injection seam to production code, these
// tests stub globalThis.fetch directly — the same black-box boundary the real
// function actually crosses — and restore it in a finally block.

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function withFakeGooglePlacesResponse(places: unknown[], run: () => Promise<void>): Promise<void> {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ places }),
    };
  }) as unknown as typeof fetch;

  return run().finally(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_API_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_API_KEY;
  });
}

const PERCH_PLACE = {
  id: "ChIJudU-mKf0fVMR4I83exkVEP8",
  displayName: { text: "Perch Sky Lounge" },
  formattedAddress: "460 Doyle Ave #701, Kelowna, BC V1Y 0C2, Canada",
  addressComponents: [
    { longText: "460", shortText: "460", types: ["street_number"] },
    { longText: "Doyle Avenue", shortText: "Doyle Ave", types: ["route"] },
    { longText: "Kelowna", shortText: "Kelowna", types: ["locality"] },
    { longText: "British Columbia", shortText: "BC", types: ["administrative_area_level_1"] },
    { longText: "Canada", shortText: "CA", types: ["country"] },
  ],
  location: { latitude: 49.8890989, longitude: -119.4940332 },
  rating: 4.3,
  userRatingCount: 443,
};

// ── Part 10.6: reconciliation success ─────────────────────────────────────────

test("reconciliation success: unmatched venue with a confident Google match gets place_id/rating/reviews attached and becomes matched", async () => {
  await withFakeGooglePlacesResponse([PERCH_PLACE], async () => {
    const { client, rows } = createFakeVenuesGoogleIdentityClient([
      { id: "venue-1", place_id: null, google_identity_status: "unmatched" },
    ]);

    const result = await reconcileVenueGoogleIdentity(
      {
        venueId: "venue-1",
        name: "Perch Sky Lounge",
        streetAddress: "701 - 460 Doyle Ave",
        city: "Kelowna",
        province: "BC",
      },
      client
    );

    assert.deepEqual(result, {
      outcome: "matched",
      placeId: "ChIJudU-mKf0fVMR4I83exkVEP8",
      rating: 4.3,
      reviewCount: 443,
    });

    const row = rows[0];
    assert.equal(row.place_id, "ChIJudU-mKf0fVMR4I83exkVEP8");
    assert.equal(row.google_rating, 4.3);
    assert.equal(row.google_review_count, 443);
    assert.equal(row.google_identity_status, "matched");
  });
});

// ── Part 10.7: reconciliation failure ─────────────────────────────────────────

test("reconciliation failure: a candidate that fails the confidence gate is NOT attached — venue stays unmatched", async () => {
  const wrongBusiness = {
    ...PERCH_PLACE,
    displayName: { text: "A Completely Different Business" },
  };
  await withFakeGooglePlacesResponse([wrongBusiness], async () => {
    const { client, rows } = createFakeVenuesGoogleIdentityClient([
      { id: "venue-2", place_id: null, google_identity_status: "unmatched" },
    ]);

    const result = await reconcileVenueGoogleIdentity(
      {
        venueId: "venue-2",
        name: "Perch Sky Lounge",
        streetAddress: "701 - 460 Doyle Ave",
        city: "Kelowna",
        province: "BC",
      },
      client
    );

    assert.deepEqual(result, { outcome: "no_match" });

    const row = rows[0];
    assert.equal(row.place_id, null);
    assert.equal(row.google_identity_status, "unmatched");
  });
});

test("reconciliation failure: no Google candidates returned leaves the venue unmatched", async () => {
  await withFakeGooglePlacesResponse([], async () => {
    const { client, rows } = createFakeVenuesGoogleIdentityClient([
      { id: "venue-3", place_id: null, google_identity_status: "unmatched" },
    ]);

    const result = await reconcileVenueGoogleIdentity(
      { venueId: "venue-3", name: "Nonexistent Bar", streetAddress: null, city: "Kelowna", province: "BC" },
      client
    );

    assert.deepEqual(result, { outcome: "no_match" });
    assert.equal(rows[0].place_id, null);
  });
});

// ── Part 10.8: exempt venue is never automatically reconciled ────────────────

test("exempt venue: reconciliation is skipped without even calling Google — exemption is never silently overridden", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({ places: [PERCH_PLACE] }) };
  }) as unknown as typeof fetch;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";

  try {
    const { client, rows } = createFakeVenuesGoogleIdentityClient([
      { id: "venue-4", place_id: null, google_identity_status: "exempt" },
    ]);

    const result = await reconcileVenueGoogleIdentity(
      { venueId: "venue-4", name: "The Placery", streetAddress: null, city: "Kelowna", province: "BC" },
      client
    );

    assert.deepEqual(result, { outcome: "skipped", reason: "exempt" });
    assert.equal(fetchCalled, false, "exempt venues must never even attempt a Google search");
    assert.equal(rows[0].google_identity_status, "exempt");
    assert.equal(rows[0].place_id, null);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_API_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_API_KEY;
  }
});

test("already-matched venue: reconciliation is skipped — never re-searches a venue that already has a place_id", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({ places: [PERCH_PLACE] }) };
  }) as unknown as typeof fetch;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";

  try {
    const { client } = createFakeVenuesGoogleIdentityClient([
      { id: "venue-5", place_id: "already-set-place-id", google_identity_status: "matched" },
    ]);

    const result = await reconcileVenueGoogleIdentity(
      { venueId: "venue-5", name: "Some Venue", streetAddress: null, city: "Kelowna", province: "BC" },
      client
    );

    assert.deepEqual(result, { outcome: "skipped", reason: "already_matched" });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_API_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_API_KEY;
  }
});

test("insufficient data: missing city/province skips without calling Google", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({ places: [] }) };
  }) as unknown as typeof fetch;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";

  try {
    const { client } = createFakeVenuesGoogleIdentityClient([
      { id: "venue-6", place_id: null, google_identity_status: "unmatched" },
    ]);

    const result = await reconcileVenueGoogleIdentity(
      { venueId: "venue-6", name: "Some Venue", streetAddress: null, city: null, province: null },
      client
    );

    assert.deepEqual(result, { outcome: "skipped", reason: "insufficient_data" });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_API_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_API_KEY;
  }
});
