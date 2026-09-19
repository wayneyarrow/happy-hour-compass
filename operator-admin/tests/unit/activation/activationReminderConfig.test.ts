import { test } from "node:test";
import assert from "node:assert/strict";
import { isOperatorActivationReminderProcessingEnabled } from "../../../src/lib/activation/activationReminderConfig";

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

const VAR = "OPERATOR_ACTIVATION_REMINDERS_ENABLED";

test("isOperatorActivationReminderProcessingEnabled: unset env var means disabled", () => {
  withEnv(VAR, undefined, () => {
    assert.equal(isOperatorActivationReminderProcessingEnabled(), false);
  });
});

test("isOperatorActivationReminderProcessingEnabled: empty string means disabled", () => {
  withEnv(VAR, "", () => {
    assert.equal(isOperatorActivationReminderProcessingEnabled(), false);
  });
});

test("isOperatorActivationReminderProcessingEnabled: 'false' means disabled", () => {
  withEnv(VAR, "false", () => {
    assert.equal(isOperatorActivationReminderProcessingEnabled(), false);
  });
});

test("isOperatorActivationReminderProcessingEnabled: 'TRUE' (wrong case) means disabled — exact match only", () => {
  withEnv(VAR, "TRUE", () => {
    assert.equal(isOperatorActivationReminderProcessingEnabled(), false);
  });
});

test("isOperatorActivationReminderProcessingEnabled: '1' means disabled", () => {
  withEnv(VAR, "1", () => {
    assert.equal(isOperatorActivationReminderProcessingEnabled(), false);
  });
});

test("isOperatorActivationReminderProcessingEnabled: exact lowercase 'true' means enabled", () => {
  withEnv(VAR, "true", () => {
    assert.equal(isOperatorActivationReminderProcessingEnabled(), true);
  });
});
