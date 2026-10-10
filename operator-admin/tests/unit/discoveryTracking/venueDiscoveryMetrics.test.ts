import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenueDiscoveryItemFilter, LEGACY_DISCOVER_CLICK_ENVIRONMENT_FILTER } from "../../../src/lib/discoveryTracking/venueDiscoveryMetrics";

const V = "33333333-3333-4333-8333-333333333333";
const S1 = "66666666-6666-4666-8666-666666666666";
const S2 = "77777777-7777-4777-8777-777777777777";

test("venue cards plus the venue's Daily Special cards", () => {
  assert.equal(
    buildVenueDiscoveryItemFilter(V, [S1, S2]),
    `and(item_type.eq.venue,item_id.eq.${V}),and(item_type.eq.daily_special,item_id.in.(${S1},${S2}))`
  );
});

test("no Daily Specials → venue cards only", () => {
  assert.equal(buildVenueDiscoveryItemFilter(V, []), `and(item_type.eq.venue,item_id.eq.${V})`);
});

test("non-UUID input is never interpolated into the filter", () => {
  const f = buildVenueDiscoveryItemFilter("x),or(id.neq.0", ["bad,id"]);
  assert.equal(f, "and(item_type.eq.venue,item_id.is.null)");
});

test("legacy clicks count only when legacy (NULL) or production — never staging/preview/dev", () => {
  assert.equal(LEGACY_DISCOVER_CLICK_ENVIRONMENT_FILTER, "environment.is.null,environment.eq.production");
});

import { discoverImpressionsNote } from "../../../src/lib/discoveryTracking/venueDiscoveryMetrics";

test("operator note explains the impression restart while counting is younger than 30 days", () => {
  const now = new Date("2026-11-05T20:00:00Z");
  assert.match(discoverImpressionsNote("2026-10-20T18:00:00Z", now), /counted since Oct\.? 20, when we started measuring on-screen views, so this builds up to a full 30 days/);
  assert.equal(discoverImpressionsNote("2026-09-01T00:00:00Z", now), "Times your venue was actually on screen in homepage picks and guides");
  assert.match(discoverImpressionsNote(null, now), /starts soon/);
});

test("the counting-start date on the card comes from the data, never a fixed date", () => {
  const now = new Date("2027-03-20T20:00:00Z");
  assert.match(discoverImpressionsNote("2027-03-02T18:00:00Z", now), /counted since Mar\.? 2,/);
  assert.match(discoverImpressionsNote("2027-03-15T18:00:00Z", now), /counted since Mar\.? 15,/);
  // Exactly 30 days later the caveat disappears.
  assert.doesNotMatch(discoverImpressionsNote("2027-02-18T19:00:00Z", now), /counted since/);
});
