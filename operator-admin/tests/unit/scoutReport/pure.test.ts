import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReportWindows, coverageFor, isInWindow, vancouverWeekdayIndex } from "../../../src/lib/scoutReport/windows";
import { compareMetric, coverageComparability, labellingComparability, SMALL_SAMPLE_MIN } from "../../../src/lib/scoutReport/comparison";
import { EMAIL_PLACEHOLDER, PHONE_PLACEHOLDER, redactSearchTerm } from "../../../src/lib/scoutReport/redaction";
import { describeCommunication, isEarnedNotSent, milestoneProgress, verifyReaderCounts } from "../../../src/lib/scoutReport/milestones";
import { VENUE_VIEW_MILESTONES } from "../../../src/lib/customerSuccess/venueViewMilestones";

// ── Windows ─────────────────────────────────────────────────────────────────

test("an Oct 19 2026 run reports Oct 12–18 and compares with Oct 5–11 (PDT, UTC−7)", () => {
  const w = computeReportWindows(new Date("2026-10-19T17:00:00Z")); // Mon 10:00 PDT
  assert.equal(w.current.startUtc, "2026-10-12T07:00:00.000Z");
  assert.equal(w.current.endUtc, "2026-10-19T07:00:00.000Z");
  assert.equal(w.current.startDate, "2026-10-12");
  assert.equal(w.current.endDateInclusive, "2026-10-18");
  assert.equal(w.current.hours, 168);
  assert.equal(w.comparison.startUtc, "2026-10-05T07:00:00.000Z");
  assert.equal(w.comparison.endUtc, "2026-10-12T07:00:00.000Z");
  assert.equal(w.comparison.endDateInclusive, "2026-10-11");
  assert.match(w.current.label, /Oct\.? 12, 2026.*Oct\.? 18, 2026.*America\/Vancouver/);
});

test("any time during a week resolves to the same previous complete week, including the Monday-midnight edge", () => {
  const starts = [
    "2026-10-19T07:00:00Z", // Mon 00:00 PDT — this week has just started
    "2026-10-22T03:00:00Z", // Wed evening
    "2026-10-26T06:59:59Z", // Sun 23:59:59 PDT
  ].map((t) => computeReportWindows(new Date(t)).current.startUtc);
  assert.deepEqual(starts, Array(3).fill("2026-10-12T07:00:00.000Z"));
  // One second before Monday 00:00 the previous complete week is one earlier.
  assert.equal(computeReportWindows(new Date("2026-10-19T06:59:59Z")).current.startUtc, "2026-10-05T07:00:00.000Z");
  assert.equal(vancouverWeekdayIndex(new Date("2026-10-19T06:59:59Z")), 6);
  assert.equal(vancouverWeekdayIndex(new Date("2026-10-19T07:00:00Z")), 0);
});

test("fall-back week (DST ends Sun Nov 1 2026) is 169 hours; the next week starts at 08:00Z", () => {
  const w = computeReportWindows(new Date("2026-11-02T18:00:00Z")); // Mon 10:00 PST
  assert.equal(w.current.startUtc, "2026-10-26T07:00:00.000Z");
  assert.equal(w.current.endUtc, "2026-11-02T08:00:00.000Z");
  assert.equal(w.current.hours, 169);
  const next = computeReportWindows(new Date("2026-11-09T18:00:00Z"));
  assert.equal(next.current.startUtc, "2026-11-02T08:00:00.000Z");
  assert.equal(next.current.hours, 168);
  assert.equal(next.comparison.hours, 169);
});

test("spring-forward week (DST starts Sun Mar 14 2027) is 167 hours", () => {
  const w = computeReportWindows(new Date("2027-03-15T17:00:00Z")); // Mon 10:00 PDT
  assert.equal(w.current.startUtc, "2027-03-08T08:00:00.000Z");
  assert.equal(w.current.endUtc, "2027-03-15T07:00:00.000Z");
  assert.equal(w.current.hours, 167);
});

test("windows are half-open: the start instant is in, the end instant is out, microseconds before the end are in", () => {
  const w = { startUtc: "2026-10-12T07:00:00.000Z", endUtc: "2026-10-19T07:00:00.000Z" };
  assert.equal(isInWindow("2026-10-12T07:00:00+00:00", w), true);
  assert.equal(isInWindow("2026-10-19T07:00:00+00:00", w), false);
  assert.equal(isInWindow("2026-10-19T06:59:59.999999+00:00", w), true);
  assert.equal(isInWindow("2026-10-12T06:59:59.999+00:00", w), false);
});

// ── Coverage & comparison ───────────────────────────────────────────────────

const W = { startUtc: "2026-10-05T07:00:00.000Z", endUtc: "2026-10-12T07:00:00.000Z" };

test("coverage: full, partial when the first row is inside the window, unavailable when after it or absent", () => {
  assert.equal(coverageFor(W, "2026-06-12T00:00:00Z").status, "full");
  assert.equal(coverageFor(W, "2026-10-05T07:00:00Z").status, "full");
  assert.equal(coverageFor(W, "2026-10-10T18:00:00Z").status, "partial");
  assert.equal(coverageFor(W, "2026-10-12T07:00:00Z").status, "unavailable");
  assert.equal(coverageFor(W, null).status, "unavailable");
});

test("no change is calculated across partial coverage, and missing data is never zero", () => {
  const partial = compareMetric(40, 25, coverageComparability(coverageFor(W, "2026-06-12T00:00:00Z"), coverageFor(W, "2026-10-10T18:00:00Z")));
  assert.equal(partial.absoluteChange, null);
  assert.equal(partial.percentChange, null);
  assert.equal(partial.comparable, false);
  assert.equal(partial.current, 40);
  const missing = compareMetric(40, null, { comparable: true, reasons: [] });
  assert.equal(missing.comparison, null);
  assert.equal(missing.absoluteChange, null);
  assert.match(missing.notes.join(" "), /not treated as zero/);
});

test("small samples keep the absolute change but suppress the percentage", () => {
  const small = compareMetric(SMALL_SAMPLE_MIN - 1, 30, { comparable: true, reasons: [] });
  assert.equal(small.absoluteChange, -11);
  assert.equal(small.percentChange, null);
  const ok = compareMetric(30, 20, { comparable: true, reasons: [] });
  assert.equal(ok.percentChange, 0.5);
});

test("environment labelling: weeks on the same side compare; a week straddling the change does not", () => {
  const cur = { startUtc: "2026-10-12T07:00:00Z", endUtc: "2026-10-19T07:00:00Z" };
  const cmp = { startUtc: "2026-10-05T07:00:00Z", endUtc: "2026-10-12T07:00:00Z" };
  assert.equal(labellingComparability(cur, cmp, "2026-10-10T19:00:00Z").comparable, false);
  assert.equal(labellingComparability(cur, cmp, "2026-10-01T00:00:00Z").comparable, true);
  assert.equal(labellingComparability(cur, cmp, null).comparable, true);
  // The wording states the established rule and does not speculate about the unlabelled rows.
  const reason = labellingComparability(cur, cmp, "2026-10-10T19:00:00Z").reasons[0];
  assert.match(reason, /cannot be determined/);
  assert.doesNotMatch(reason, /test traffic|testing|QA/i);
});

// ── Redaction ───────────────────────────────────────────────────────────────

test("redacts apparent email addresses and phone numbers, keeps ordinary terms", () => {
  assert.deepEqual(redactSearchTerm("me@example.com"), { term: EMAIL_PLACEHOLDER, redacted: true });
  assert.deepEqual(redactSearchTerm("call 250 555 1234"), { term: `call ${PHONE_PLACEHOLDER}`, redacted: true });
  assert.equal(redactSearchTerm("(250) 555-1234").term, PHONE_PLACEHOLDER);
  assert.equal(redactSearchTerm("+1.250.555.1234 tacos").term, `${PHONE_PLACEHOLDER} tacos`);
  for (const t of ["wings", "2 for 1 wings", "1234 main st", "happy hour 3-6pm", "v1y 2b3"]) {
    assert.deepEqual(redactSearchTerm(t), { term: t, redacted: false });
  }
});

// ── Milestones ──────────────────────────────────────────────────────────────

test("thresholds are the existing Customer Success list, unchanged", () => {
  assert.deepEqual([...VENUE_VIEW_MILESTONES], [50, 100, 250, 500, 1000, 2500, 5000]);
});

test("approaching = remaining positive and ≤10% of the next threshold; exact thresholds and the maximum handled", () => {
  const cases: [number, number | null, number | null, boolean][] = [
    [0, 50, 50, false],
    [44, 50, 6, false],
    [45, 50, 5, true],
    [49, 50, 1, true],
    [50, 100, 50, false], // exactly at 50: reached; next is 100
    [89, 100, 11, false],
    [90, 100, 10, true],
    [99, 100, 1, true],
    [100, 250, 150, false],
    [225, 250, 25, true],
    [4500, 5000, 500, true],
    [4499, 5000, 501, false],
    [4999, 5000, 1, true],
    [5000, null, null, false], // at the maximum: nothing further
    [7000, null, null, false],
  ];
  for (const [views, next, remaining, approaching] of cases) {
    const p = milestoneProgress(views);
    assert.equal(p.next, next, `next for ${views}`);
    assert.equal(p.remaining, remaining, `remaining for ${views}`);
    assert.equal(p.approaching, approaching, `approaching for ${views}`);
  }
  assert.equal(milestoneProgress(50).highestReached, 50);
  assert.equal(milestoneProgress(5000).beyondMaximum, true);
  assert.equal(milestoneProgress(10).highestReached, null);
});

test("communication states come only from recorded columns; pending and failed are 'earned, not sent'", () => {
  const base = { venue_id: "v", milestone_value: 100, achieved_at: null, sent_at: null, next_attempt_at: null, attempt_count: 0, processing_started_at: null, recipient_blocked_reason: null };
  assert.equal(describeCommunication({ ...base, communication_status: "pending", next_attempt_at: "x" }).state, "Pending — scheduled");
  assert.equal(describeCommunication({ ...base, communication_status: "pending" }).state, "Pending — not yet scheduled");
  assert.equal(describeCommunication({ ...base, communication_status: "pending", processing_started_at: "x" }).state, "Pending — delivery in progress");
  const blocked = describeCommunication({ ...base, communication_status: "pending", recipient_blocked_reason: "no_email" });
  assert.equal(blocked.recipientBlocked, true);
  assert.equal(JSON.stringify(blocked).includes("no_email"), false, "the block reason text is not exported");
  assert.equal(describeCommunication({ ...base, communication_status: "sent" }).state, "Sent");
  assert.deepEqual(["pending", "failed", "sent", "superseded", "skipped"].map(isEarnedNotSent), [true, true, false, false, false]);
});

test("reader-count guard: a silent 0 from the reader, or a lower direct count, fails loudly", () => {
  assert.throws(() => verifyReaderCounts([{ venueId: "a", currentViews: 0 }], new Map([["a", 12]])), /appears to have failed/);
  assert.throws(() => verifyReaderCounts([{ venueId: "a", currentViews: 12 }], new Map([["a", 11]])), /inconsistent/);
  assert.doesNotThrow(() => verifyReaderCounts([{ venueId: "a", currentViews: 12 }, { venueId: "b", currentViews: 0 }], new Map([["a", 13]])));
});
