import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GIVEAWAY_CALLOUT_END_MS,
  GIVEAWAY_CALLOUT_START_MS,
  isGiveawayCalloutVisible,
} from "../../../src/lib/weeklyPicks/giveaway";

const at = (iso: string) => Date.parse(iso);

test("window boundaries are the America/Vancouver wall-clock times (PST, UTC-8)", () => {
  assert.equal(new Date(GIVEAWAY_CALLOUT_START_MS).toISOString(), "2026-11-12T19:00:00.000Z");
  assert.equal(new Date(GIVEAWAY_CALLOUT_END_MS).toISOString(), "2026-12-01T08:00:00.000Z");
});

test("hidden before opening", () => {
  assert.equal(isGiveawayCalloutVisible(at("2026-11-06T12:00:00-08:00")), false);
  assert.equal(isGiveawayCalloutVisible(at("2026-11-12T10:59:59.999-08:00")), false);
});

test("visible from 11:00 a.m. Nov 12 through 11:59:59 p.m. Nov 30 Pacific", () => {
  assert.equal(isGiveawayCalloutVisible(at("2026-11-12T11:00:00-08:00")), true);
  assert.equal(isGiveawayCalloutVisible(at("2026-11-20T18:30:00-08:00")), true);
  assert.equal(isGiveawayCalloutVisible(at("2026-11-30T23:59:00-08:00")), true);
  assert.equal(isGiveawayCalloutVisible(at("2026-11-30T23:59:59.999-08:00")), true);
});

test("hidden from midnight Dec 1 Pacific onward", () => {
  assert.equal(isGiveawayCalloutVisible(at("2026-12-01T00:00:00-08:00")), false);
  assert.equal(isGiveawayCalloutVisible(at("2026-12-02T12:00:00-08:00")), false);
  assert.equal(isGiveawayCalloutVisible(at("2027-01-01T00:00:00-08:00")), false);
});

const SRC = join(__dirname, "../../../src");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (p: string) => stripComments(readFileSync(join(SRC, p), "utf8"));

test("/weekly-picks renders per request, and the callout sits after the signup form", () => {
  const page = read("app/(website)/weekly-picks/page.tsx");
  assert.match(page, /export const dynamic = "force-dynamic";/);
  const form = page.indexOf("<WeeklyPicksSignupForm");
  const callout = page.indexOf("{showGiveaway && <GiveawayCallout />}");
  assert.ok(form > -1 && callout > form);
});

test("the rules page never depends on the callout schedule", () => {
  const rules = read("app/(website)/weekly-picks/giveaway-rules/page.tsx");
  assert.doesNotMatch(rules, /weeklyPicks\/giveaway|isGiveawayCalloutVisible|force-dynamic|notFound/);
});
