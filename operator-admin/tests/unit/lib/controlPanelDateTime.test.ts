import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDateTime,
  formatDate,
  formatDateISO,
  CONTROL_PANEL_TIME_ZONE,
} from "../../../src/lib/controlPanelDateTime";

// ── Sanity ───────────────────────────────────────────────────────────────────

test("CONTROL_PANEL_TIME_ZONE is the IANA Pacific zone (handles PST/PDT via DST rules)", () => {
  assert.equal(CONTROL_PANEL_TIME_ZONE, "America/Vancouver");
});

// ── A. Summer / PDT ──────────────────────────────────────────────────────────

test("formatDateTime converts a summer (PDT) UTC instant to Pacific local time — the bug's original repro case", () => {
  // The exact stored value from the operator-submissions investigation.
  assert.equal(formatDateTime("2026-08-22T02:54:02.143252+00:00"), "Aug 21, 2026, 7:54 PM");
});

// ── B. Winter / PST ──────────────────────────────────────────────────────────

test("formatDateTime converts a winter (PST) UTC instant using the UTC-8 offset", () => {
  assert.equal(formatDateTime("2026-01-15T04:30:00.000Z"), "Jan 14, 2026, 8:30 PM");
});

// ── C. DST transition behavior ───────────────────────────────────────────────

test("formatDateTime relies on IANA DST rules, not a fixed offset, across the spring-forward transition", () => {
  // America/Vancouver springs forward at 2026-03-08 02:00 PST -> 03:00 PDT,
  // i.e. at 2026-03-08T10:00:00Z. Two UTC instants only 2 minutes apart,
  // straddling that moment, must land 61 minutes apart on the Pacific wall
  // clock (skipping the 2:00-3:00 AM hour that never happens that day). A
  // formatter using a fixed UTC-8 or UTC-7 offset instead of real tz rules
  // could not reproduce this jump.
  assert.equal(formatDateTime("2026-03-08T09:59:00.000Z"), "Mar 8, 2026, 1:59 AM"); // still PST
  assert.equal(formatDateTime("2026-03-08T10:01:00.000Z"), "Mar 8, 2026, 3:01 AM"); // now PDT
});

test("formatDateTime relies on IANA DST rules across the fall-back transition too", () => {
  // America/Vancouver falls back at 2026-11-01 02:00 PDT -> 01:00 PST,
  // i.e. at 2026-11-01T09:00:00Z. The 1:00-2:00 AM hour repeats, so the wall
  // clock moves backward even though real time moved forward.
  assert.equal(formatDateTime("2026-11-01T08:59:00.000Z"), "Nov 1, 2026, 1:59 AM"); // still PDT
  assert.equal(formatDateTime("2026-11-01T09:01:00.000Z"), "Nov 1, 2026, 1:01 AM"); // now PST
});

// ── D. Date-only calendar boundary ───────────────────────────────────────────

test("formatDate shows the Pacific calendar day, not the UTC day, for a timestamp near UTC midnight", () => {
  // 2026-08-22T02:54:02Z is Aug 22 in UTC but Aug 21 in Pacific time — the
  // exact discrepancy that produced the original Control Panel bug report.
  assert.equal(formatDate("2026-08-22T02:54:02.143252+00:00"), "Aug 21, 2026");
});

test("formatDateISO shows the same Pacific calendar day in en-CA short form", () => {
  assert.equal(formatDateISO("2026-08-22T02:54:02.143252+00:00"), "2026-08-21");
});

// ── E. Runtime timezone independence ─────────────────────────────────────────

test("formatDateTime output does not depend on the process/machine default timezone", () => {
  const originalTz = process.env.TZ;
  try {
    // Point the process's own default timezone somewhere unrelated. If the
    // helper ever stopped passing an explicit `timeZone`, this would change
    // the result — it must not.
    process.env.TZ = "Asia/Tokyo";
    assert.equal(formatDateTime("2026-08-22T02:54:02.143252+00:00"), "Aug 21, 2026, 7:54 PM");
    assert.equal(formatDate("2026-08-22T02:54:02.143252+00:00"), "Aug 21, 2026");

    process.env.TZ = "UTC";
    assert.equal(formatDateTime("2026-08-22T02:54:02.143252+00:00"), "Aug 21, 2026, 7:54 PM");
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

// ── Null / undefined / invalid handling ──────────────────────────────────────

test("all three formatters return the em dash for null, undefined, or an unparseable value", () => {
  for (const bad of [null, undefined, "not-a-date", ""] as const) {
    assert.equal(formatDateTime(bad), "—");
    assert.equal(formatDate(bad), "—");
    assert.equal(formatDateISO(bad), "—");
  }
});

// ── Input flexibility / purity ───────────────────────────────────────────────

test("formatDateTime accepts a Date object directly, with the same result as its ISO string", () => {
  const iso = "2026-08-22T02:54:02.143252+00:00";
  assert.equal(formatDateTime(new Date(iso)), formatDateTime(iso));
});

test("formatting never mutates the input Date", () => {
  const d = new Date("2026-08-22T02:54:02.143252+00:00");
  const before = d.getTime();
  formatDateTime(d);
  formatDate(d);
  formatDateISO(d);
  assert.equal(d.getTime(), before);
});
