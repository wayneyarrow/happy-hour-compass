import { test } from "node:test";
import assert from "node:assert/strict";
import { VENUE_VIEW_MILESTONES } from "../../../src/lib/customerSuccess/venueViewMilestones";
import {
  MILESTONE_EMAIL_VALUES,
  MILESTONE_EMAIL_CLOSING,
  getMilestoneEmailCopy,
} from "../../../src/lib/customerSuccess/milestoneEmailCopy";

// ── Supported milestone values ──────────────────────────────────────────────

test("MILESTONE_EMAIL_VALUES is exactly VENUE_VIEW_MILESTONES — single source of truth, no drift", () => {
  assert.deepEqual(MILESTONE_EMAIL_VALUES, VENUE_VIEW_MILESTONES);
  assert.deepEqual([...MILESTONE_EMAIL_VALUES], [50, 100, 250, 500, 1000, 2500, 5000]);
});

test("getMilestoneEmailCopy returns copy for every one of the 7 approved milestones", () => {
  for (const m of VENUE_VIEW_MILESTONES) {
    const copy = getMilestoneEmailCopy(m);
    assert.ok(copy, `expected copy for milestone ${m}`);
    assert.equal(copy!.milestone, m);
  }
});

test("getMilestoneEmailCopy returns null for any unsupported value", () => {
  for (const bad of [0, -1, 49, 51, 75, 999, 1001, 6000, 3.5]) {
    assert.equal(getMilestoneEmailCopy(bad), null, `expected null for ${bad}`);
  }
});

// ── Display value formatting ─────────────────────────────────────────────────

test("displayValue is comma-formatted for 1,000+ and plain below", () => {
  assert.equal(getMilestoneEmailCopy(50)!.displayValue, "50");
  assert.equal(getMilestoneEmailCopy(100)!.displayValue, "100");
  assert.equal(getMilestoneEmailCopy(250)!.displayValue, "250");
  assert.equal(getMilestoneEmailCopy(500)!.displayValue, "500");
  assert.equal(getMilestoneEmailCopy(1000)!.displayValue, "1,000");
  assert.equal(getMilestoneEmailCopy(2500)!.displayValue, "2,500");
  assert.equal(getMilestoneEmailCopy(5000)!.displayValue, "5,000");
});

// ── Subject / preview text mapping ───────────────────────────────────────────

test("every milestone's subject carries the {venue} placeholder exactly once", () => {
  for (const m of VENUE_VIEW_MILESTONES) {
    const copy = getMilestoneEmailCopy(m)!;
    const occurrences = copy.subject.split("{venue}").length - 1;
    assert.equal(occurrences, 1, `milestone ${m} subject should contain {venue} exactly once`);
  }
});

test("every milestone's first body paragraph carries the {venue} placeholder exactly once", () => {
  for (const m of VENUE_VIEW_MILESTONES) {
    const copy = getMilestoneEmailCopy(m)!;
    const occurrences = copy.body[0].split("{venue}").length - 1;
    assert.equal(occurrences, 1, `milestone ${m} body[0] should contain {venue} exactly once`);
  }
});

test("every milestone has a non-empty subject, previewText, headline, and label", () => {
  for (const m of VENUE_VIEW_MILESTONES) {
    const copy = getMilestoneEmailCopy(m)!;
    assert.ok(copy.subject.length > 0);
    assert.ok(copy.previewText.length > 0);
    assert.ok(copy.headline.length > 0);
    assert.equal(copy.label, "VENUE VIEWS");
  }
});

// ── Exact approved copy — regression guard against accidental rewording ────

test("50-view copy matches the approved wording exactly", () => {
  const copy = getMilestoneEmailCopy(50)!;
  assert.equal(copy.subject, "\u{1F389} {venue} just hit 50 views on Happy Hour Compass");
  assert.equal(copy.previewText, "Your venue is getting noticed.");
  assert.equal(copy.headline, "You’re getting noticed. \u{1F389}");
  assert.equal(copy.body[0], "{venue} has now reached 50 venue views on Happy Hour Compass.");
  assert.equal(
    copy.body[1],
    "It’s an early milestone, but a good one — people are finding your venue and checking out what you have to offer."
  );
});

test("5,000-view copy matches the approved wording exactly", () => {
  const copy = getMilestoneEmailCopy(5000)!;
  assert.equal(copy.subject, "\u{1F389} 5,000 views — what a milestone for {venue}");
  assert.equal(copy.previewText, "This one is worth celebrating.");
  assert.equal(copy.headline, "Now that’s some serious momentum. \u{1F389}");
  assert.equal(copy.body[0], "{venue} has now reached 5,000 venue views on Happy Hour Compass.");
  assert.equal(
    copy.body[1],
    "That’s an incredible milestone. Your venue continues to get discovered by people looking for somewhere great to eat, drink and go out."
  );
});

test("the closing line is identical for every milestone (one shared constant)", () => {
  assert.equal(
    MILESTONE_EMAIL_CLOSING,
    "Thanks for being part of Happy Hour Compass. We’re happy to keep sending people your way."
  );
  // Every copy entry omits its own closing — it's appended once by the template.
  for (const m of VENUE_VIEW_MILESTONES) {
    const copy = getMilestoneEmailCopy(m)!;
    assert.equal(copy.body.length, 2, `milestone ${m} should have exactly 2 body paragraphs, not the closing baked in`);
  }
});
