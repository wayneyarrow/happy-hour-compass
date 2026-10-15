import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScoutReport } from "../../../src/lib/scoutReport/buildScoutReport";
import { ENVIRONMENT_LABELLING_ROLLOUT_AT, effectiveLabellingStart } from "../../../src/lib/scoutReport/comparison";
import { TRACKING_STARTS, fakeDeps } from "./fixtures";
import type { EventViewRow, VenueViewRow } from "../../../src/lib/scoutReport/usageData";

/**
 * Environment labelling reached every /api/track/* route in one release
 * (2026-10-10, earliest labelled row 23:09:25 UTC). Event views had no
 * traffic around it — last unlabelled row Oct 8, first labelled Oct 12 — so
 * their own first labelled row must not be used as the change point.
 */

// Real first-labelled timestamps (2026-10-15 read-only check).
const STARTS = {
  ...TRACKING_STARTS,
  venueViews: { firstRecordedAt: "2026-06-12T18:00:00+00:00", labellingStartedAt: "2026-10-10T23:09:29.999447+00:00" },
  eventViews: { firstRecordedAt: "2026-06-12T18:00:00+00:00", labellingStartedAt: "2026-10-12T22:48:43.260176+00:00" },
};

const rows = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

function depsFor(cur: { start: string }, counts: { evCur: number; evCmp: number; vvCur: number; vvCmp: number }) {
  const isCur = (w: { startUtc: string }) => w.startUtc === cur.start;
  return fakeDeps({
    usage: {
      trackingStarts: async () => STARTS,
      loadEventViewRows: async (w) => rows<EventViewRow>(isCur(w) ? counts.evCur : counts.evCmp, (i) => ({ id: `e${i}`, event_id: "ev", environment: null })),
      loadVenueViewRows: async (w) => rows<VenueViewRow>(isCur(w) ? counts.vvCur : counts.vvCmp, (i) => ({ id: `v${i}`, venue_id: "v", environment: null })),
      loadDailySpecialClickRows: async () => [],
    },
  }).deps;
}

test("rollout constant matches the evidence: the earliest labelled tracking row, rounded down to the minute", () => {
  assert.equal(ENVIRONMENT_LABELLING_ROLLOUT_AT, "2026-10-10T23:09:00.000Z");
  // A table's later first labelled row never moves the change point later…
  assert.equal(effectiveLabellingStart("2026-10-12T22:48:43.260176+00:00"), ENVIRONMENT_LABELLING_ROLLOUT_AT);
  assert.equal(effectiveLabellingStart(null), ENVIRONMENT_LABELLING_ROLLOUT_AT);
  // …but an earlier one would (conservative).
  assert.equal(effectiveLabellingStart("2026-10-09T00:00:00Z"), "2026-10-09T00:00:00.000Z");
});

test("Oct 5–11 report: event views are NOT compared with Sep 28–Oct 4, even though their first labelled row is Oct 12", async () => {
  const deps = depsFor({ start: "2026-10-05T07:00:00.000Z" }, { evCur: 10, evCmp: 25, vvCur: 753, vvCmp: 614 });
  const r = await buildScoutReport({ now: new Date("2026-10-15T18:00:00Z"), deps });
  const pu = r.sections.productUsage.data!;
  assert.equal(r.windows.current.startDate, "2026-10-05");
  // Totals are reported exactly as established.
  assert.equal(pu.eventViews.current.total, 10);
  assert.equal(pu.eventViews.comparison.total, 25);
  // The change is suppressed, with the rollout explanation — same as venue views.
  for (const m of [pu.eventViews, pu.venueViews]) {
    assert.equal(m.change.comparable, false);
    assert.equal(m.change.absoluteChange, null);
    assert.equal(m.change.percentChange, null);
    assert.match(m.change.notes.join(" "), /rolled out at 2026-10-10T23:09:00\.000Z/);
  }
  assert.equal(r.summary.headlines.eventViews.absoluteChange, null);
});

test("Oct 12–18 report (comparison Oct 5–11 straddles the rollout): event views not compared either", async () => {
  const deps = depsFor({ start: "2026-10-12T07:00:00.000Z" }, { evCur: 30, evCmp: 10, vvCur: 100, vvCmp: 753 });
  const pu = (await buildScoutReport({ now: new Date("2026-10-19T17:00:00Z"), deps })).sections.productUsage.data!;
  assert.equal(pu.eventViews.change.comparable, false);
  assert.equal(pu.eventViews.change.absoluteChange, null);
});

test("weeks entirely after the rollout compare normally; metrics whose rule ignores labels are unaffected", async () => {
  const deps = depsFor({ start: "2026-10-19T07:00:00.000Z" }, { evCur: 30, evCmp: 24, vvCur: 120, vvCmp: 100 });
  const pu = (await buildScoutReport({ now: new Date("2026-10-26T17:00:00Z"), deps })).sections.productUsage.data!;
  assert.equal(pu.eventViews.change.comparable, true);
  assert.equal(pu.eventViews.change.absoluteChange, 6);
  assert.equal(pu.eventViews.change.percentChange, 0.25);
  assert.equal(pu.venueViews.change.comparable, true);

  // Daily Specials clicks count every environment, so labelling doesn't change what's counted: comparable across it.
  const before = (await buildScoutReport({ now: new Date("2026-10-15T18:00:00Z"), deps: depsFor({ start: "2026-10-05T07:00:00.000Z" }, { evCur: 0, evCmp: 0, vvCur: 0, vvCmp: 0 }) })).sections.productUsage.data!;
  assert.equal(before.dailySpecialClicks.change.comparable, true);
});

test("only Scout's comparison labels changed — no counting module touched", () => {
  const src = readFileSync(join(__dirname, "../../../src/lib/scoutReport/buildScoutReport.ts"), "utf8");
  assert.match(src, /effectiveLabellingStart\(starts\.venueViews\.labellingStartedAt\)/);
  assert.match(src, /effectiveLabellingStart\(starts\.eventViews\.labellingStartedAt\)/);
  const usage = readFileSync(join(__dirname, "../../../src/lib/scoutReport/usageData.ts"), "utf8");
  assert.match(usage, /COUNTED_VIEW_ENVIRONMENT_FILTER/, "counting predicate unchanged");
});
