import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateConsumerBrevoEligibility } from "../../../src/lib/brevo/consumerEligibility";
import { createFakeConsumerLookupClient } from "./support/fakeConsumerLookupClient";

const CONSUMER_ID = "11111111-1111-1111-1111-111111111111";

test("no profile row -> not eligible, reason no_profile", async () => {
  const client = createFakeConsumerLookupClient({ profiles: [], authUsers: [] });
  const result = await evaluateConsumerBrevoEligibility(CONSUMER_ID, client);
  assert.deepEqual(result, { eligible: false, reason: "no_profile" });
});

test("profile with no usable email -> not eligible, reason no_usable_email", async () => {
  const client = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: null, display_name: null, marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const result = await evaluateConsumerBrevoEligibility(CONSUMER_ID, client);
  assert.deepEqual(result, { eligible: false, reason: "no_usable_email" });
});

test("profile with marketing_consent=false -> not eligible, reason no_consent", async () => {
  const client = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: false }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const result = await evaluateConsumerBrevoEligibility(CONSUMER_ID, client);
  assert.deepEqual(result, { eligible: false, reason: "no_consent" });
});

test("consented but unconfirmed email -> not eligible, reason unconfirmed_email", async () => {
  const client = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: null }],
  });
  const result = await evaluateConsumerBrevoEligibility(CONSUMER_ID, client);
  assert.deepEqual(result, { eligible: false, reason: "unconfirmed_email" });
});

test("confirmed + consented + usable email -> eligible", async () => {
  const client = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const result = await evaluateConsumerBrevoEligibility(CONSUMER_ID, client);
  assert.deepEqual(result, { eligible: true, email: "wayne@example.com", displayName: "Wayne" });
});

test("profile exists in auth.users lookup as entirely absent -> unconfirmed_email, not a crash", async () => {
  const client = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: null, marketing_consent: true }],
    authUsers: [], // no matching auth user at all
  });
  const result = await evaluateConsumerBrevoEligibility(CONSUMER_ID, client);
  assert.deepEqual(result, { eligible: false, reason: "unconfirmed_email" });
});
