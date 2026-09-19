import { test } from "node:test";
import assert from "node:assert/strict";
import { writeActivationNote } from "../../../src/lib/activation/activationNotes";

/**
 * Behavioral coverage for writeActivationNote()'s success/failure branching,
 * supporting the Phase 1A correction's requirement that a structured-note
 * insert failure must be reported (never thrown/swallowed) without
 * corrupting anything else — activation state itself lives in
 * venue_claims/operator_submissions' own columns (already committed by the
 * caller's earlier UPDATE/INSERT before this function is ever called), so a
 * failure here can only ever mean the note is missing, never that the
 * activation itself becomes unusable.
 */

function fakeSupabase(insertResult: { error: { message: string } | null }) {
  let capturedTable = "";
  let capturedPayload: Record<string, unknown> | null = null;
  const client = {
    from(table: string) {
      capturedTable = table;
      return {
        insert(payload: Record<string, unknown>) {
          capturedPayload = payload;
          return Promise.resolve(insertResult);
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, getTable: () => capturedTable, getPayload: () => capturedPayload };
}

test("writeActivationNote: success returns ok:true and inserts into venue_claim_notes for a claim origin", async () => {
  const fake = fakeSupabase({ error: null });
  const result = await writeActivationNote(
    {
      origin: { type: "claim", claimId: "claim-1" },
      eventType: "activation_started",
      note: "test note",
      metadata: { activationDeadline: "2026-10-01T00:00:00.000Z", flow: "claim" },
    },
    fake.client
  );
  assert.deepEqual(result, { ok: true, alreadyExisted: false });
  assert.equal(fake.getTable(), "venue_claim_notes");
  assert.equal((fake.getPayload() as Record<string, unknown>).claim_id, "claim-1");
});

test("writeActivationNote: success inserts into operator_submission_notes for a submission origin", async () => {
  const fake = fakeSupabase({ error: null });
  await writeActivationNote(
    {
      origin: { type: "submission", submissionId: "sub-1" },
      eventType: "account_activated",
      note: "test note",
    },
    fake.client
  );
  assert.equal(fake.getTable(), "operator_submission_notes");
  assert.equal((fake.getPayload() as Record<string, unknown>).submission_id, "sub-1");
});

test("writeActivationNote: DB error returns ok:false with the error message — never throws", async () => {
  const fake = fakeSupabase({ error: { message: "insert failed" } });
  await assert.doesNotReject(async () => {
    const result = await writeActivationNote(
      { origin: { type: "claim", claimId: "claim-1" }, eventType: "activation_started", note: "n" },
      fake.client
    );
    assert.deepEqual(result, { ok: false, error: "insert failed" });
  });
});

test("writeActivationNote: always attributes to the Happy Hour Compass system author, never a real user id", async () => {
  const fake = fakeSupabase({ error: null });
  await writeActivationNote(
    { origin: { type: "claim", claimId: "claim-1" }, eventType: "activation_started", note: "n" },
    fake.client
  );
  const payload = fake.getPayload() as Record<string, unknown>;
  assert.equal(payload.created_by, null);
  assert.equal(payload.created_by_email, "Happy Hour Compass");
});

// ── Phase 2A-3: eventKey / event_key uniqueness ─────────────────────────────

test("writeActivationNote: omitting eventKey writes event_key as null (unaffected pre-Phase-2A-3 behavior)", async () => {
  const fake = fakeSupabase({ error: null });
  await writeActivationNote(
    { origin: { type: "claim", claimId: "claim-1" }, eventType: "activation_started", note: "n" },
    fake.client
  );
  const payload = fake.getPayload() as Record<string, unknown>;
  assert.equal(payload.event_key, null);
});

test("writeActivationNote: passing eventKey writes it verbatim into the payload", async () => {
  const fake = fakeSupabase({ error: null });
  await writeActivationNote(
    {
      origin: { type: "submission", submissionId: "sub-1" },
      eventType: "reminder_sent",
      note: "n",
      eventKey: "hhc-activation-reminder:lc-1:2",
    },
    fake.client
  );
  const payload = fake.getPayload() as Record<string, unknown>;
  assert.equal(payload.event_key, "hhc-activation-reminder:lc-1:2");
});

test("writeActivationNote: a 23505 (event_key already exists) is treated as success, not an error", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake: any = fakeSupabase({ error: { message: "duplicate key value violates unique constraint", code: "23505" } as any });
  const result = await writeActivationNote(
    {
      origin: { type: "claim", claimId: "claim-1" },
      eventType: "reminder_sent",
      note: "n",
      eventKey: "hhc-activation-reminder:lc-1:1",
    },
    fake.client
  );
  assert.deepEqual(result, { ok: true, alreadyExisted: true });
});

test("writeActivationNote: a 23505 WITHOUT an eventKey is still a real failure — the conflict-tolerance only applies to deliberate event_key retries", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake: any = fakeSupabase({ error: { message: "some other unique constraint", code: "23505" } as any });
  const result = await writeActivationNote(
    { origin: { type: "claim", claimId: "claim-1" }, eventType: "activation_started", note: "n" },
    fake.client
  );
  assert.deepEqual(result, { ok: false, error: "some other unique constraint" });
});
