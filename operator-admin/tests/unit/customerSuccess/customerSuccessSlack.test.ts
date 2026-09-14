import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMilestoneSuccessSlackText,
  buildMilestoneFailureSlackText,
  buildRecipientBlockedSlackText,
} from "../../../src/lib/customerSuccess/customerSuccessSlack";

// ── Success notification ────────────────────────────────────────────────────

test("success Slack message includes venue, milestone, and recipient", () => {
  const text = buildMilestoneSuccessSlackText({
    venueName: "Buffalo Rouge Brewing Co.",
    displayValue: "100",
    recipientFirstName: "Kelly",
    recipientEmail: "kelly@example.com",
  });
  assert.match(text, /Venue milestone email sent/);
  assert.match(text, /Buffalo Rouge Brewing Co\./);
  assert.match(text, /100 views/);
  assert.match(text, /Kelly — kelly@example\.com/);
});

// ── Failure / retry notification ────────────────────────────────────────────

test("failure Slack message with a scheduled retry includes attempt number and next retry time", () => {
  const nextRetryAt = new Date("2026-01-05T16:00:00Z");
  const text = buildMilestoneFailureSlackText({
    venueName: "Buffalo Rouge Brewing Co.",
    displayValue: "250",
    recipientEmail: "kelly@example.com",
    attemptNumber: 1,
    willRetry: true,
    nextRetryAt,
    errorSummary: "Provider timeout",
  });
  assert.match(text, /Customer Success email failed/);
  assert.match(text, /Attempt:\* 1 of 3/);
  assert.match(text, /Next retry:\* 2026-01-05T16:00:00\.000Z/);
  assert.match(text, /Provider timeout/);
  assert.doesNotMatch(text, /Final attempt failed/);
});

// ── Final-failure notification ──────────────────────────────────────────────

test("final-failure Slack message clearly says manual attention is required, no next-retry line", () => {
  const text = buildMilestoneFailureSlackText({
    venueName: "Buffalo Rouge Brewing Co.",
    displayValue: "250",
    recipientEmail: "kelly@example.com",
    attemptNumber: 3,
    willRetry: false,
    nextRetryAt: null,
    errorSummary: "Provider timeout",
  });
  assert.match(text, /Final attempt failed — manual attention required\./);
  assert.match(text, /Attempt:\* 3 of 3/);
  assert.doesNotMatch(text, /Next retry:/);
});

test("failure message shows 'unknown' recipient rather than crashing when recipient is null", () => {
  const text = buildMilestoneFailureSlackText({
    venueName: "V",
    displayValue: "50",
    recipientEmail: null,
    attemptNumber: 1,
    willRetry: true,
    nextRetryAt: new Date(),
    errorSummary: "x",
  });
  assert.match(text, /Recipient:\* unknown/);
});

// ── Recipient-blocked notification — distinct wording ───────────────────────

test("recipient-blocked message is visibly distinct wording from a delivery failure — data-resolution issue", () => {
  const text = buildRecipientBlockedSlackText({
    venueName: "Buffalo Rouge Brewing Co.",
    displayValue: "250",
    reason: "ambiguous_recipient",
  });
  assert.match(text, /Customer Success email blocked/);
  assert.match(text, /multiple active operator users, no designated admin recipient/);
  assert.match(text, /data-resolution issue, not an email-provider failure/);
  assert.doesNotMatch(text, /Customer Success email failed/);
});

test("blocked message wording differs for no-active-recipient vs ambiguous vs unresolvable timezone", () => {
  const noActive = buildRecipientBlockedSlackText({ venueName: "V", displayValue: "50", reason: "no_active_recipient" });
  const ambiguous = buildRecipientBlockedSlackText({ venueName: "V", displayValue: "50", reason: "ambiguous_recipient" });
  const noTimezone = buildRecipientBlockedSlackText({ venueName: "V", displayValue: "50", reason: "no_resolvable_timezone" });
  assert.match(noActive, /no active operator user found/);
  assert.match(ambiguous, /multiple active operator users/);
  assert.match(noTimezone, /no resolvable market\/timezone/);
  assert.notEqual(noActive, ambiguous);
});
