import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_MODE_ORDER,
  DISCOVERY_MODES,
  DEFAULT_DISCOVERY_MODE,
  isDiscoveryMode,
} from "../../../src/lib/homepageDiscoveryModes";

/**
 * Homepage Hero — Happy Hours / Daily Specials / Events discovery mode
 * configuration. HeroSection.tsx drives its selector, CTA, and search pill
 * entirely off this one object — these tests pin its shape so a future
 * edit can't silently drop a mode, reorder the selector, or point a CTA at
 * a route that doesn't exist.
 */

test("three modes exist, in Happy Hours / Daily Specials / Events order", () => {
  assert.deepEqual(DISCOVERY_MODE_ORDER, ["happy_hours", "daily_specials", "events"]);
});

test("Happy Hours is the default mode", () => {
  assert.equal(DEFAULT_DISCOVERY_MODE, "happy_hours");
});

test("Daily Specials sits between Happy Hours and Events in selector order", () => {
  assert.equal(DISCOVERY_MODE_ORDER[1], "daily_specials");
});

test("each mode has a distinct, non-empty label, CTA label, and destination", () => {
  const labels = new Set<string>();
  const ctaLabels = new Set<string>();
  const destinations = new Set<string>();
  for (const mode of DISCOVERY_MODE_ORDER) {
    const config = DISCOVERY_MODES[mode];
    assert.ok(config.label.length > 0);
    assert.ok(config.ctaLabel.length > 0);
    assert.ok(config.destination.startsWith("/"));
    labels.add(config.label);
    ctaLabels.add(config.ctaLabel);
    destinations.add(config.destination);
  }
  assert.equal(labels.size, 3);
  assert.equal(ctaLabels.size, 3);
  assert.equal(destinations.size, 3);
});

test("Happy Hours mode targets the existing Happy Hours discovery route", () => {
  const config = DISCOVERY_MODES.happy_hours;
  assert.equal(config.destination, "/website-happy-hours");
  assert.equal(config.ctaLabel, "Browse Happy Hours");
  assert.equal(config.supportsQuerySearch, true);
});

test("Daily Specials mode targets /website-daily-specials and supports ?q= search", () => {
  const config = DISCOVERY_MODES.daily_specials;
  assert.equal(config.destination, "/website-daily-specials");
  assert.equal(config.ctaLabel, "Browse Daily Specials");
  assert.equal(config.supportsQuerySearch, true);
});

test("Events mode targets the existing Events discovery route and supports ?q= search", () => {
  const config = DISCOVERY_MODES.events;
  assert.equal(config.destination, "/website-events");
  assert.equal(config.ctaLabel, "Browse Events");
  // EventSearchResults.tsx now filters on `q` via eventMatchesSearch() (the
  // mode-aware search correction) — see homepageDiscoveryModes.ts's header
  // comment and tests/unit/homepage/eventSearch.test.ts.
  assert.equal(config.supportsQuerySearch, true);
});

test("isDiscoveryMode narrows valid mode strings and rejects unknown values", () => {
  assert.equal(isDiscoveryMode("happy_hours"), true);
  assert.equal(isDiscoveryMode("daily_specials"), true);
  assert.equal(isDiscoveryMode("events"), true);
  assert.equal(isDiscoveryMode("brunch"), false);
  assert.equal(isDiscoveryMode(""), false);
});
