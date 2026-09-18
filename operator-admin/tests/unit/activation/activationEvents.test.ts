import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVATION_EVENT_TYPES,
  ACTIVATION_EVENT_LABELS,
  getActivationEventLabel,
} from "../../../src/lib/activation/activationEvents";

test("ACTIVATION_EVENT_LABELS has a friendly label for every event type in the vocabulary — no future type silently unlabeled", () => {
  for (const eventType of ACTIVATION_EVENT_TYPES) {
    assert.ok(
      typeof ACTIVATION_EVENT_LABELS[eventType] === "string" && ACTIVATION_EVENT_LABELS[eventType].length > 0,
      `missing label for event type "${eventType}"`
    );
  }
});

test("getActivationEventLabel: null event_type (legacy free-text note) → null, never a placeholder string", () => {
  assert.equal(getActivationEventLabel(null), null);
});

test("getActivationEventLabel: known event type → its friendly label", () => {
  assert.equal(getActivationEventLabel("manual_resend"), "Setup email resent");
  assert.equal(getActivationEventLabel("deadline_extended"), "Activation deadline extended");
  assert.equal(getActivationEventLabel("activation_started"), "Activation started");
  assert.equal(getActivationEventLabel("account_activated"), "Account activated");
});

test("getActivationEventLabel: unrecognized future event type falls back safely instead of throwing or rendering 'undefined'", () => {
  assert.equal(getActivationEventLabel("some_future_event_type_not_yet_added"), "System event");
});
