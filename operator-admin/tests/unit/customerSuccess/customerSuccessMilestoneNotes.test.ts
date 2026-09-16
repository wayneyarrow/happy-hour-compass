import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCustomerSuccessMilestoneNote } from "../../../src/lib/customerSuccess/customerSuccessMilestoneNotes";

const BASE = {
  id: "evt-1",
  milestone_value: 50,
  achieved_at: "2026-09-14T21:00:23.319Z",
  next_attempt_at: null as string | null,
  sent_at: null as string | null,
  last_attempted_at: null as string | null,
  attempt_count: 0,
  recipient_email: null as string | null,
  recipient_blocked_reason: null as string | null,
  processing_started_at: null as string | null,
  metadata_json: null as unknown,
};

test("sent — real production shape (The Landing) renders recipient first name + email", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    id: "760a3f1a-46df-4b41-9f1c-4da6052439b5",
    communication_status: "sent",
    sent_at: "2026-09-15T22:00:20.353Z",
    last_attempted_at: "2026-09-15T22:00:20.353Z",
    attempt_count: 1,
    recipient_email: "jfenton@ilmercatosocialkitchen.com",
    metadata_json: { deliverySnapshot: { recipientFirstName: "Jocelyn", venueName: "The Landing Kitchen + Bar" } },
  });
  assert.ok(result);
  assert.equal(
    result!.note,
    "Customer Success: 50-view milestone email sent to Jocelyn (jfenton@ilmercatosocialkitchen.com)."
  );
  assert.equal(result!.created_at, "2026-09-15T22:00:20.353Z");
  assert.equal(result!.id, "cs-760a3f1a-46df-4b41-9f1c-4da6052439b5");
});

test("sent — no delivery snapshot falls back to bare email", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "sent",
    sent_at: "2026-09-15T22:00:20.353Z",
    recipient_email: "someone@example.com",
    metadata_json: null,
  });
  assert.equal(result!.note, "Customer Success: 50-view milestone email sent to someone@example.com.");
});

test("pending — scheduled with no snapshot yet omits recipient entirely", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "pending",
    next_attempt_at: "2026-09-15T22:00:00.000Z",
    recipient_email: null,
    metadata_json: null,
  });
  assert.ok(result);
  assert.match(result!.note, /^Customer Success: 50-view milestone email scheduled for /);
  assert.ok(!result!.note.includes("—"), "must not fabricate a recipient before a snapshot is locked");
  assert.equal(result!.created_at, "2026-09-15T22:00:00.000Z");
});

test("pending — retry-scheduled WITH an already-locked snapshot includes the recipient", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "pending",
    next_attempt_at: "2026-09-16T22:00:00.000Z",
    attempt_count: 1,
    recipient_email: "jfenton@ilmercatosocialkitchen.com",
    metadata_json: { deliverySnapshot: { recipientFirstName: "Jocelyn", venueName: "The Landing Kitchen + Bar" } },
  });
  assert.match(result!.note, /Jocelyn \(jfenton@ilmercatosocialkitchen\.com\)\.$/);
});

test("pending — achieved but not yet scheduled (no next_attempt_at, not blocked)", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "pending",
    next_attempt_at: null,
  });
  assert.equal(result!.note, "Customer Success: 50-view milestone achieved — awaiting scheduling.");
  assert.equal(result!.created_at, BASE.achieved_at);
});

test("pending — blocked (ambiguous recipient) never shows a recipient", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "pending",
    next_attempt_at: "2026-09-15T22:00:00.000Z",
    recipient_blocked_reason: "ambiguous_recipient",
  });
  assert.equal(result!.note, "Customer Success: 50-view milestone email blocked — ambiguous recipient.");
});

test("pending — blocked (no active recipient)", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "pending",
    recipient_blocked_reason: "no_active_recipient",
  });
  assert.equal(result!.note, "Customer Success: 50-view milestone email blocked — no active recipient.");
});

test("pending — blocked (no resolvable timezone)", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "pending",
    recipient_blocked_reason: "no_resolvable_timezone",
  });
  assert.equal(result!.note, "Customer Success: 50-view milestone email blocked — unresolved venue timezone.");
});

test("processing renders a distinct in-flight message", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "processing",
    processing_started_at: "2026-09-15T22:00:20.000Z",
  });
  assert.equal(result!.note, "Customer Success: 50-view milestone email is currently being sent.");
  assert.equal(result!.created_at, "2026-09-15T22:00:20.000Z");
});

test("failed after exhausting attempts renders attempt count accurately", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "failed",
    attempt_count: 3,
    last_attempted_at: "2026-09-15T23:00:00.000Z",
  });
  assert.equal(
    result!.note,
    "Customer Success: 50-view milestone email failed after 3 attempts — manual attention required."
  );
});

test("failed singular attempt uses singular wording", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "failed",
    attempt_count: 1,
    last_attempted_at: "2026-09-15T23:00:00.000Z",
  });
  assert.match(result!.note, /failed after 1 attempt —/);
});

test("superseded is never displayed", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "superseded",
  });
  assert.equal(result, null);
});

test("skipped is hidden for now — semantics not yet defined for any real code path", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "skipped",
  });
  assert.equal(result, null);
});

test("an unrecognized status is omitted rather than guessed", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    communication_status: "some_future_status",
  });
  assert.equal(result, null);
});

test("a row with no milestone_value is omitted", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    milestone_value: null,
    communication_status: "sent",
  });
  assert.equal(result, null);
});

test("milestone label uses the approved comma-formatted display value", () => {
  const result = formatCustomerSuccessMilestoneNote({
    ...BASE,
    milestone_value: 1000,
    communication_status: "sent",
    recipient_email: "a@b.com",
  });
  assert.match(result!.note, /^Customer Success: 1,000-view milestone email sent/);
});
