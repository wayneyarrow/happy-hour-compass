import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectTodaysSpecials,
  deterministicTieBreakSeed,
  TODAYS_SPECIALS_DEFAULT_LIMIT,
  type TodaysSpecialCandidateInput,
  type TodaysSpecialOverride,
} from "../../../src/lib/todaysSpecialsRanking";
import type { WebsiteDailySpecialListItem } from "../../../src/lib/data/dailySpecials";

/**
 * Today's Specials homepage selection/ranking — see
 * src/lib/todaysSpecialsRanking.ts's module header for the full pipeline
 * and manual-override-compatibility rationale.
 *
 * "unpublished excluded" / "wrong market excluded" are NOT tested here —
 * those rules are enforced upstream by getPublishedDailySpecialsForWebsite()
 * (the venues!inner is_published join + market-radius filter), which this
 * module's caller (todaysSpecialsHomepage.ts) reuses unmodified rather than
 * re-implementing. selectTodaysSpecials() only ever sees candidates that
 * already passed those checks.
 */

// 2026-09-16 is a Wednesday (matches the existing convention in
// tests/unit/dailySpecials/consumerWhenFilter.test.ts).
const WEDNESDAY = "2026-09-16";
const TUESDAY = "2026-09-15";
const THURSDAY = "2026-09-17";

let venueCounter = 0;
function buildSpecial(overrides: Partial<WebsiteDailySpecialListItem> = {}): WebsiteDailySpecialListItem {
  venueCounter += 1;
  return {
    id: `special-${venueCounter}`,
    title: `Special ${venueCounter}`,
    offerType: "food",
    shortSummary: null,
    description: null,
    conditions: null,
    imageUrl: null,
    schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null },
    time: { timeMode: "timed", startTime: "16:00", endMode: "time", endTime: "21:00" },
    venueId: `venue-${venueCounter}`,
    venueName: `Venue ${venueCounter}`,
    venueSlug: `venue-${venueCounter}`,
    venueEstablishmentType: "restaurant",
    venuePlaceholderImagePath: null,
    venueLat: null,
    venueLng: null,
    venueIsVerified: false,
    marketSlug: "central-okanagan",
    citySlug: "kelowna",
    ...overrides,
  };
}

function candidate(special: WebsiteDailySpecialListItem, venueViews = 0): TodaysSpecialCandidateInput {
  return { special, venueViews };
}

// ─────────────────────────────────────────────────────────────────────────
// Today eligibility
// ─────────────────────────────────────────────────────────────────────────

test("a weekly Special active today is included", () => {
  const s = buildSpecial({ schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null } });
  const result = selectTodaysSpecials({ candidates: [candidate(s)], todayIso: WEDNESDAY });
  assert.deepEqual(result.map((r) => r.id), [s.id]);
});

test("a weekly Special not active today (wrong weekday) is excluded", () => {
  const s = buildSpecial({ schedule: { scheduleType: "weekly", daysOfWeek: [1], recurrenceStartDate: null, recurrenceEndDate: null } }); // Monday only
  const result = selectTodaysSpecials({ candidates: [candidate(s)], todayIso: WEDNESDAY });
  assert.deepEqual(result, []);
});

test("a one-time Special dated today is included", () => {
  const s = buildSpecial({ schedule: { scheduleType: "one_time", oneTimeDate: WEDNESDAY } });
  const result = selectTodaysSpecials({ candidates: [candidate(s)], todayIso: WEDNESDAY });
  assert.deepEqual(result.map((r) => r.id), [s.id]);
});

test("a future one-time Special is excluded", () => {
  const s = buildSpecial({ schedule: { scheduleType: "one_time", oneTimeDate: THURSDAY } });
  const result = selectTodaysSpecials({ candidates: [candidate(s)], todayIso: WEDNESDAY });
  assert.deepEqual(result, []);
});

test("a past one-time Special is excluded", () => {
  const s = buildSpecial({ schedule: { scheduleType: "one_time", oneTimeDate: TUESDAY } });
  const result = selectTodaysSpecials({ candidates: [candidate(s)], todayIso: WEDNESDAY });
  assert.deepEqual(result, []);
});

test("a weekly Special whose recurrence hasn't started yet is excluded (recurrence boundary respected)", () => {
  const s = buildSpecial({
    schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: THURSDAY, recurrenceEndDate: null },
  });
  const result = selectTodaysSpecials({ candidates: [candidate(s)], todayIso: WEDNESDAY });
  assert.deepEqual(result, []);
});

test("a weekly Special whose recurrence has already ended is excluded (recurrence boundary respected)", () => {
  const s = buildSpecial({
    schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: TUESDAY },
  });
  const result = selectTodaysSpecials({ candidates: [candidate(s)], todayIso: WEDNESDAY });
  assert.deepEqual(result, []);
});

test("zero eligible candidates yields an empty selection (caller hides the section)", () => {
  const result = selectTodaysSpecials({ candidates: [], todayIso: WEDNESDAY });
  assert.deepEqual(result, []);
});

// ─────────────────────────────────────────────────────────────────────────
// One per venue
// ─────────────────────────────────────────────────────────────────────────

test("multiple eligible Specials at the same venue yield at most one homepage selection", () => {
  const venueId = "shared-venue";
  const weak = buildSpecial({ venueId, venueName: "Shared Venue" });
  const strong = buildSpecial({ venueId, venueName: "Shared Venue" });
  const result = selectTodaysSpecials({
    candidates: [candidate(weak, 5), candidate(strong, 40)],
    todayIso: WEDNESDAY,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, strong.id); // the higher-scoring (more viewed) one wins the venue's slot
});

test("one-per-venue still holds across a full six-slot selection", () => {
  const dupeVenueId = "shared-venue-6up";
  const dupeWeak = buildSpecial({ venueId: dupeVenueId });
  const dupeStrong = buildSpecial({ venueId: dupeVenueId });
  const others = Array.from({ length: 6 }, () => candidate(buildSpecial(), 10));
  const result = selectTodaysSpecials({
    candidates: [candidate(dupeWeak, 1), candidate(dupeStrong, 30), ...others],
    todayIso: WEDNESDAY,
  });
  assert.equal(result.length, 6);
  const venueIds = result.map((r) => r.venueId);
  assert.equal(new Set(venueIds).size, 6); // no venue appears twice
  const dupeVenuePick = result.find((r) => r.venueId === dupeVenueId);
  assert.equal(dupeVenuePick?.id, dupeStrong.id); // the shared venue's slot (it wins one, being the highest-viewed candidate overall) goes to the stronger Special, never the weaker one
});

// ─────────────────────────────────────────────────────────────────────────
// Ranking — verified boost
// ─────────────────────────────────────────────────────────────────────────

test("a verified venue's Special outranks an equally-unpopular unverified one", () => {
  const verified = buildSpecial({ venueIsVerified: true });
  const unverified = buildSpecial({ venueIsVerified: false });
  const result = selectTodaysSpecials({ candidates: [candidate(verified, 0), candidate(unverified, 0)], todayIso: WEDNESDAY });
  assert.equal(result[0].id, verified.id);
});

test("the verified boost is not absolute — a heavily-viewed unverified Special can match it, not blow past it", () => {
  // MAX_POPULARITY_VIEWS caps the popularity contribution at the same
  // magnitude as the verified boost (see todaysSpecialsRanking.ts) — so a
  // maximally-popular unverified Special ties a verified-but-unpopular one
  // rather than beating it outright. A tie is resolved by the deterministic
  // tie-break, never a guaranteed popularity win.
  const verified = buildSpecial({ venueIsVerified: true });
  const veryPopular = buildSpecial({ venueIsVerified: false });
  const result = selectTodaysSpecials({
    candidates: [candidate(verified, 0), candidate(veryPopular, 500)], // far beyond the popularity cap
    todayIso: WEDNESDAY,
  });
  // Both Specials must still both be selected (2 distinct venues, no
  // exclusion) — this assertion is about them being a genuine tie, not
  // about popularity being excluded from the result outright.
  assert.equal(result.length, 2);
});

// ─────────────────────────────────────────────────────────────────────────
// Ranking — popularity
// ─────────────────────────────────────────────────────────────────────────

test("among otherwise-equal candidates, more recent venue views ranks higher", () => {
  const lessViewed = buildSpecial();
  const moreViewed = buildSpecial();
  const result = selectTodaysSpecials({
    candidates: [candidate(lessViewed, 3), candidate(moreViewed, 25)],
    todayIso: WEDNESDAY,
  });
  assert.equal(result[0].id, moreViewed.id);
});

// ─────────────────────────────────────────────────────────────────────────
// Deterministic ordering / cap
// ─────────────────────────────────────────────────────────────────────────

test("the same inputs and date produce the same selection and order every time", () => {
  const candidates = [buildSpecial(), buildSpecial(), buildSpecial()].map((s) => candidate(s, 7));
  const first = selectTodaysSpecials({ candidates, todayIso: WEDNESDAY }).map((r) => r.id);
  const second = selectTodaysSpecials({ candidates, todayIso: WEDNESDAY }).map((r) => r.id);
  assert.deepEqual(first, second);
});

test("deterministicTieBreakSeed is a pure function of (date, id) — same inputs, same seed", () => {
  assert.equal(deterministicTieBreakSeed(WEDNESDAY, "special-1"), deterministicTieBreakSeed(WEDNESDAY, "special-1"));
});

test("selection is capped at the default limit of 6 even with more eligible candidates", () => {
  const candidates = Array.from({ length: 9 }, () => candidate(buildSpecial(), 10));
  const result = selectTodaysSpecials({ candidates, todayIso: WEDNESDAY });
  assert.equal(TODAYS_SPECIALS_DEFAULT_LIMIT, 6);
  assert.equal(result.length, 6);
});

test("a smaller eligible pool than the limit returns exactly what's eligible, no placeholders", () => {
  const candidates = [candidate(buildSpecial()), candidate(buildSpecial())];
  const result = selectTodaysSpecials({ candidates, todayIso: WEDNESDAY });
  assert.equal(result.length, 2);
});

// ─────────────────────────────────────────────────────────────────────────
// Diversity
// ─────────────────────────────────────────────────────────────────────────

test("across six slots, a comparably-scored but differently-typed candidate is favored over a same-type near-tie", () => {
  const a = candidate(buildSpecial({ offerType: "food" }), 50); // merit 20 (capped)
  const b = candidate(buildSpecial({ offerType: "food" }), 45); // merit 18
  const c = candidate(buildSpecial({ offerType: "food" }), 40); // merit 16
  const d = candidate(buildSpecial({ offerType: "food" }), 35); // merit 14
  const e = candidate(buildSpecial({ offerType: "food" }), 30); // merit 12
  const f = candidate(buildSpecial({ offerType: "food" }), 27.5); // merit 11 — the naive 6th pick
  const g = candidate(buildSpecial({ offerType: "drink" }), 26); // merit 10.4 — a genuine near-tie with f (within DIVERSITY_SCORE_BAND), but a different type
  const h = candidate(buildSpecial({ offerType: "food_drink" }), 5); // merit 2 — clearly too far behind to qualify as a near-tie with anything above

  const result = selectTodaysSpecials({ candidates: [a, b, c, d, e, f, g, h], todayIso: WEDNESDAY, limit: 6 });
  const ids = result.map((r) => r.id);
  // a-e are clearly top-5 by score, each too far ahead of any other type to
  // be swapped out; the 6th slot is a genuine near-tie between f (food) and
  // g (drink), where the soft diversity preference picks g.
  assert.deepEqual(ids, [a.special.id, b.special.id, c.special.id, d.special.id, e.special.id, g.special.id]);
  assert.equal(result.filter((r) => r.offerType === "food").length, 5);
  assert.equal(result.filter((r) => r.offerType === "drink").length, 1);
});

test("still fills all six slots when no diverse alternative exists", () => {
  const candidates = [
    candidate(buildSpecial({ offerType: "food" }), 50),
    candidate(buildSpecial({ offerType: "food" }), 40),
    candidate(buildSpecial({ offerType: "food" }), 30),
    candidate(buildSpecial({ offerType: "food" }), 20),
    candidate(buildSpecial({ offerType: "food" }), 15),
    candidate(buildSpecial({ offerType: "food" }), 10),
  ];
  const result = selectTodaysSpecials({ candidates, todayIso: WEDNESDAY, limit: 6 });
  assert.equal(result.length, 6);
  assert.ok(result.every((r) => r.offerType === "food"));
});

// ─────────────────────────────────────────────────────────────────────────
// Manual override compatibility (no schema yet — see module header)
// ─────────────────────────────────────────────────────────────────────────

test("an exclude override removes an otherwise top-ranked candidate", () => {
  const excluded = buildSpecial({ venueIsVerified: true });
  const fallback = buildSpecial();
  const overrides: TodaysSpecialOverride[] = [{ dailySpecialId: excluded.id, action: "exclude", boost: 0 }];
  const result = selectTodaysSpecials({
    candidates: [candidate(excluded, 100), candidate(fallback, 0)],
    todayIso: WEDNESDAY,
    overrides,
  });
  assert.deepEqual(result.map((r) => r.id), [fallback.id]);
});

test("an include override forces its Special to win that venue's slot over a naturally stronger sibling", () => {
  const venueId = "override-venue";
  const naturallyStronger = buildSpecial({ venueId, venueIsVerified: true });
  const overridden = buildSpecial({ venueId });
  const overrides: TodaysSpecialOverride[] = [{ dailySpecialId: overridden.id, action: "include", boost: 0 }];
  const result = selectTodaysSpecials({
    candidates: [candidate(naturallyStronger, 50), candidate(overridden, 0)],
    todayIso: WEDNESDAY,
    overrides,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, overridden.id);
});

test("override boost outranks organic signals entirely, mirroring Collections' boost-lifts-first ordering", () => {
  const boosted = buildSpecial(); // no verified, no views — organically weak
  const organicWinner = buildSpecial({ venueIsVerified: true });
  const overrides: TodaysSpecialOverride[] = [{ dailySpecialId: boosted.id, action: "include", boost: 1 }];
  const result = selectTodaysSpecials({
    candidates: [candidate(boosted, 0), candidate(organicWinner, 50)],
    todayIso: WEDNESDAY,
    overrides,
  });
  assert.equal(result[0].id, boosted.id);
});
