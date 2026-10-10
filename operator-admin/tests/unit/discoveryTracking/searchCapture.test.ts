import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSearchCaptureController,
  type CapturedSearch,
  type SearchCaptureResults,
  type SearchCaptureState,
} from "../../../src/lib/discoveryTracking/searchCapture";
import { createFakeScheduler } from "./fakeScheduler";

const R = (count: number, capped = false): SearchCaptureResults => ({ count, capped, otherFiltersActive: null });

function setup() {
  const scheduler = createFakeScheduler();
  const emitted: CapturedSearch[] = [];
  let n = 0;
  const c = createSearchCaptureController({ emit: (s) => emitted.push(s), scheduler, generateId: () => `id-${++n}` });
  const type = (query: string, results: SearchCaptureResults | null = R(3), extra: Partial<SearchCaptureState> = {}) =>
    c.update({ query, mode: "happy_hours", origin: "typed", results, ...extra });
  return { scheduler, c, emitted, type };
}

test("typing with short pauses logs only the settled term, after a 1s pause (no partial words)", () => {
  const { scheduler, emitted, type } = setup();
  for (const q of ["w", "wi", "win", "wine"]) {
    type(q);
    scheduler.advance(400); // a 400ms gap used to log every prefix (200ms debounce)
  }
  assert.equal(emitted.length, 0);
  scheduler.advance(600);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].searchTerm, "wine");
  assert.equal(emitted[0].trigger, "pause");
});

test("Enter captures immediately; the following pause does not double-capture", () => {
  const { scheduler, c, emitted, type } = setup();
  type("tacos");
  const id = c.captureNow("enter");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].trigger, "enter");
  assert.equal(id, emitted[0].searchId);
  scheduler.advance(5000);
  assert.equal(emitted.length, 1);
});

test("selection after the pause already captured returns the same search id without a second row", () => {
  const { scheduler, c, emitted, type } = setup();
  type("joey");
  scheduler.advance(1000);
  assert.equal(emitted.length, 1);
  const id = c.captureNow("selection");
  assert.equal(id, emitted[0].searchId);
  assert.equal(emitted.length, 1);
});

test("Enter then selection on the same term is one row", () => {
  const { c, emitted, type } = setup();
  type("wings");
  c.captureNow("enter");
  c.captureNow("selection");
  assert.equal(emitted.length, 1);
});

test("same term with different casing/whitespace is the same search", () => {
  const { scheduler, emitted, type } = setup();
  type("Wine Bar");
  scheduler.advance(1000);
  type("  wine   bar ");
  scheduler.advance(1000);
  assert.equal(emitted.length, 1);
});

test("Enter before results are known is held and captured the moment results arrive", () => {
  const { c, emitted, type } = setup();
  type("trivia", null);
  assert.equal(c.captureNow("enter"), null);
  assert.equal(emitted.length, 0);
  type("trivia", R(12));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].trigger, "enter");
  assert.equal(emitted[0].resultCount, 12);
});

test("a held Enter is dropped if the query changes before results arrive", () => {
  const { scheduler, c, emitted, type } = setup();
  type("triv", null);
  c.captureNow("enter");
  type("trivia night", null);
  type("trivia night", R(2));
  assert.equal(emitted.length, 0); // waits for its own pause
  scheduler.advance(1000);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].trigger, "pause");
});

test("the same text in another mode is a distinct search", () => {
  const { scheduler, emitted, type } = setup();
  type("wings", R(3), { mode: "happy_hours" });
  scheduler.advance(1000);
  type("wings", R(5), { mode: "daily_specials" });
  scheduler.advance(1000);
  assert.deepEqual(emitted.map((e) => e.mode), ["happy_hours", "daily_specials"]);
});

test("clearing the field resets: retyping the same term later counts again", () => {
  const { scheduler, emitted, type } = setup();
  type("wine");
  scheduler.advance(1000);
  type("");
  type("wine");
  scheduler.advance(1000);
  assert.equal(emitted.length, 2);
});

test("results changing for an already-captured term (e.g. a filter toggled) never re-captures", () => {
  const { scheduler, emitted, type } = setup();
  type("patio", R(10));
  scheduler.advance(1000);
  type("patio", R(4));
  scheduler.advance(5000);
  assert.equal(emitted.length, 1);
});

test("records origin, full/capped counts and filters exactly as given", () => {
  const { scheduler, c, emitted } = setup();
  c.update({ query: "boston pizza", mode: "happy_hours", origin: "url", results: { count: 0, capped: false, otherFiltersActive: true } });
  scheduler.advance(1000);
  assert.deepEqual(
    { origin: emitted[0].origin, resultCount: emitted[0].resultCount, capped: emitted[0].resultCountCapped, filters: emitted[0].otherFiltersActive },
    { origin: "url", resultCount: 0, capped: false, filters: true }
  );
});

test("whitespace-only queries are never captured", () => {
  const { scheduler, c, emitted, type } = setup();
  type("   ");
  assert.equal(c.captureNow("enter"), null);
  scheduler.advance(5000);
  assert.equal(emitted.length, 0);
});

test("dispose (unmount) cancels a pending pause capture", () => {
  const { scheduler, c, emitted, type } = setup();
  type("wine");
  c.dispose();
  scheduler.advance(5000);
  assert.equal(emitted.length, 0);
});

test("A → B → A records three searches (only consecutive repeats are collapsed)", () => {
  const { scheduler, emitted, type } = setup();
  type("wine");
  scheduler.advance(1000);
  type("beer");
  scheduler.advance(1000);
  type("wine");
  scheduler.advance(1000);
  assert.deepEqual(emitted.map((e) => e.searchTerm), ["wine", "beer", "wine"]);
  assert.equal(new Set(emitted.map((e) => e.searchId)).size, 3);
});

test("A → (B typed but never settled) → A is still one search", () => {
  const { scheduler, emitted, type } = setup();
  type("wine");
  scheduler.advance(1000);
  type("wine b");
  scheduler.advance(500);
  type("wine");
  scheduler.advance(2000);
  assert.deepEqual(emitted.map((e) => e.searchTerm), ["wine"]);
});

test("same term, different filters: one row, carrying the filter state + count at capture time", () => {
  const { scheduler, c, emitted } = setup();
  const s = (count: number, filters: boolean) =>
    c.update({ query: "patio", mode: "happy_hours", origin: "typed", results: { count, capped: false, otherFiltersActive: filters } });
  s(12, false);
  scheduler.advance(1000);
  s(3, true); // visitor then turns on "On Now"
  scheduler.advance(5000);
  assert.equal(emitted.length, 1);
  assert.deepEqual([emitted[0].resultCount, emitted[0].otherFiltersActive], [12, false]);
});

test("filters set before typing are reflected in the captured count", () => {
  const { scheduler, c, emitted } = setup();
  c.update({ query: "patio", mode: "happy_hours", origin: "typed", results: { count: 3, capped: false, otherFiltersActive: true } });
  scheduler.advance(1000);
  assert.deepEqual([emitted[0].resultCount, emitted[0].otherFiltersActive], [3, true]);
});
