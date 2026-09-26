import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClockTime, formatCountdown, messageForStatus, normalizeCodeInput } from "../../../src/app/operator/verify/verifyScreenLogic";
import type { EmailCodeVerificationStatus } from "../../../src/lib/activation/emailCodeVerificationTypes";

test("code entry: typing, pasting spaced/dashed codes, and autofill all normalize to six digits", () => {
  assert.equal(normalizeCodeInput("1"), "1");
  assert.equal(normalizeCodeInput("123456"), "123456");
  assert.equal(normalizeCodeInput("123 456"), "123456");
  assert.equal(normalizeCodeInput(" 123-456 "), "123456");
  assert.equal(normalizeCodeInput("Your code: 042917"), "042917", "leading zero kept");
  assert.equal(normalizeCodeInput("1234567890"), "123456", "capped at six");
  assert.equal(normalizeCodeInput("abc"), "");
});

test("countdown: m:ss, rounding up partial seconds, never negative", () => {
  assert.equal(formatCountdown(60_000), "1:00");
  assert.equal(formatCountdown(59_001), "1:00");
  assert.equal(formatCountdown(9_000), "0:09");
  assert.equal(formatCountdown(600_000), "10:00");
  assert.equal(formatCountdown(-5), "0:00");
  assert.equal(formatCountdown(3_600_000), "1:00:00", "daily-limit waits show hours");
  assert.equal(formatCountdown(23 * 3_600_000 + 59 * 60_000 + 30_000), "23:59:30");
});

test("messages: every server status has plain, non-technical copy", () => {
  const statuses: EmailCodeVerificationStatus[] = [
    "code_sent",
    "verified",
    "invalid_code",
    "expired",
    "attempts_exhausted",
    "resend_cooldown",
    "rate_limited",
    "unavailable",
    "invalid_format",
    "send_failed",
  ];
  for (const status of statuses) {
    const text = messageForStatus(status);
    assert.ok(text.length > 0, status);
    assert.ok(!/lifecycle|digest|hmac|rpc|supabase|null|undefined/i.test(text), `${status}: ${text}`);
  }
  assert.match(messageForStatus("invalid_code"), /isn’t right/);
  assert.match(messageForStatus("expired"), /Request a new code/);
  assert.match(messageForStatus("attempts_exhausted"), /Request a new code/);
  assert.match(messageForStatus("rate_limited", new Date(Date.now() + 5 * 60_000).toISOString()), /request a new code (at|on) /);
  assert.match(messageForStatus("rate_limited"), /please wait before trying again/);
});

test("clock time: same-day shows just the time; a different day adds the weekday", () => {
  const now = new Date(2026, 8, 25, 10, 0);
  assert.ok(!formatClockTime(new Date(2026, 8, 25, 15, 30).toISOString(), now).includes(" at "));
  assert.match(formatClockTime(new Date(2026, 8, 26, 9, 15).toISOString(), now), /^\S+ at /);
});

test("code-sent copy: first send says 'a code'; only a server-reported resend says 'a new code'", () => {
  assert.equal(messageForStatus("code_sent"), "We sent you a code. Codes expire after 10 minutes.");
  assert.equal(messageForStatus("code_sent", null, { isResend: false }), "We sent you a code. Codes expire after 10 minutes.");
  assert.equal(messageForStatus("code_sent", null, { isResend: true }), "We sent you a new code. Codes expire after 10 minutes.");
});
