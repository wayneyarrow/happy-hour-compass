import { test } from "node:test";
import assert from "node:assert/strict";
import { linkVenueToSubmission } from "../../../src/lib/google/linkVenueToSubmission";
import { toVenueGoogleFields, type GoogleMatch } from "../../../src/lib/google/placesMatch";
import { createFakeOperatorSubmissionClient } from "./support/fakeOperatorSubmissionClient";

// ── Casa de Frida regression coverage ───────────────────────────────────────
//
// Root cause (confirmed in production): saveOperatorSubmissionAction's
// Case A path ((consumer)/suggest/owner/actions.ts) generates a submission
// id up front and used to set it directly on the new venue's INSERT, before
// the operator_submissions row that owns that id existed. Because
// venues.source_submission_id -> operator_submissions.id is a NOT
// DEFERRABLE foreign key, that INSERT always failed with Postgres error
// 23503. The fix: create the venue with source_submission_id left NULL,
// insert the submission, then link the two via linkVenueToSubmission().
//
// A GoogleMatch approximating Casa de Frida's real Google Places result
// (place_id captured from the actual production log entry).
const CASA_DE_FRIDA_MATCH: GoogleMatch = {
  placeId: "ChIJfwpbX6j0fVMR9uQl7ImC5-k",
  name: "Casa de Frida",
  formattedAddress: "526 Lawrence Ave, Kelowna, BC V1Y 6L4, Canada",
  streetAddress: "526 Lawrence Ave",
  city: "Kelowna",
  province: "British Columbia",
  provinceShort: "BC",
  postalCode: "V1Y 6L4",
  country: "Canada",
  lat: 49.8859,
  lng: -119.4964,
  phone: "+1 250-555-0100",
  website: null,
  rating: 4.6,
  reviewCount: 128,
  photoReference: null,
};

test("confirmed_auto: new Google-matched venue — venue creation, submission creation, and linkage all succeed with no FK violation, and Google identity/rating fields are correct", async () => {
  const { client, venues, submissions } = createFakeOperatorSubmissionClient();

  // Step 1 — venue INSERT, exactly as saveOperatorSubmissionAction's Case A
  // now builds it: source_submission_id is NOT part of this payload, and
  // Google identity fields come from the real toVenueGoogleFields() mapper.
  const venueInsert = await client
    .from("venues")
    .insert({
      name: "Casa de Frida",
      slug: "kelowna-casa-de-frida",
      address_line1: CASA_DE_FRIDA_MATCH.streetAddress,
      city: CASA_DE_FRIDA_MATCH.city,
      region: CASA_DE_FRIDA_MATCH.provinceShort,
      is_published: false,
      source: "operator_submission",
      ...toVenueGoogleFields(CASA_DE_FRIDA_MATCH),
    })
    .select("id")
    .single();
  assert.equal(venueInsert.error, null, "venue creation must succeed");
  const venueId = venueInsert.data!.id as string;

  // Step 2 — operator_submissions INSERT, already knowing venue_id (this
  // part of the flow was never broken — only the reverse link was).
  const submissionInsert = await client
    .from("operator_submissions")
    .insert({
      id: "11111111-1111-1111-1111-111111111111",
      venue_name: "Casa de Frida",
      email: "casadefridakelowna@gmail.com",
      venue_id: venueId,
      status: "confirmed_auto",
      match_status: "confirmed",
      place_id: CASA_DE_FRIDA_MATCH.placeId,
    })
    .select("id")
    .single();
  assert.equal(submissionInsert.error, null, "submission creation must succeed");
  const submissionId = submissionInsert.data!.id as string;

  // Step 3 — the fix under test: link the venue back to its submission now
  // that the submission row actually exists.
  const linkResult = await linkVenueToSubmission(client, venueId, submissionId);
  assert.deepEqual(linkResult, { ok: true });

  // Bidirectional linkage.
  const venue = venues.find((v) => v.id === venueId)!;
  const submission = submissions.find((s) => s.id === submissionId)!;
  assert.equal(submission.venue_id, venueId, "operator_submissions.venue_id -> venue");
  assert.equal(venue.source_submission_id, submissionId, "venues.source_submission_id -> submission");

  // Google identity/rating fields preserved correctly.
  assert.equal(venue.place_id, "ChIJfwpbX6j0fVMR9uQl7ImC5-k");
  assert.equal(venue.google_rating, 4.6);
  assert.equal(venue.google_review_count, 128);
  assert.equal(venue.google_identity_status, "matched");
});

test("regression guard: pre-setting venues.source_submission_id on INSERT to a not-yet-existing submission id fails with the real FK violation — proves the fake models the exact constraint that caused the Casa de Frida production failure", async () => {
  const { client } = createFakeOperatorSubmissionClient();

  // This reproduces the OLD (buggy) behaviour directly: setting
  // source_submission_id up front, before any operator_submissions row
  // with that id exists.
  const venueInsert = await client
    .from("venues")
    .insert({
      name: "Casa de Frida",
      source_submission_id: "22222222-2222-2222-2222-222222222222",
    })
    .select("id")
    .single();

  assert.equal(venueInsert.data, null);
  assert.equal(venueInsert.error?.code, "23503");
  assert.match(venueInsert.error?.message ?? "", /venues_source_submission_id_fk/);
});

test("linkVenueToSubmission surfaces a failed link as { ok: false } rather than throwing", async () => {
  const { client } = createFakeOperatorSubmissionClient();

  // A real submission row (so the FK itself is satisfiable), but a venue id
  // that doesn't exist — models the "linkage update fails" case Part 3 of
  // the fix has to handle without throwing/failing the whole submission.
  const submissionInsert = await client
    .from("operator_submissions")
    .insert({ id: "33333333-3333-3333-3333-333333333333", venue_name: "Casa de Frida" })
    .select("id")
    .single();
  const submissionId = submissionInsert.data!.id as string;

  const result = await linkVenueToSubmission(client, "nonexistent-venue-id", submissionId);
  assert.equal(result.ok, false);
});
