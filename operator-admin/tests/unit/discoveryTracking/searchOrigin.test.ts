import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMountOrigin, HANDOFF_MAX_AGE_MS, HISTORY_WINDOW_MS } from "../../../src/lib/discoveryTracking/searchOrigin";

const base = {
  now: 100_000,
  query: "wine",
  mode: "happy_hours" as const,
  lastPopstateAt: null,
  navigationType: "navigate",
  atInitialDocumentUrl: true,
  handoff: null,
};

test("a fresh page load with ?q= is a url search", () => {
  assert.equal(resolveMountOrigin(base), "url");
});

test("a client-side Back/Forward (popstate just before mount) is history", () => {
  assert.equal(resolveMountOrigin({ ...base, lastPopstateAt: base.now - 200, atInitialDocumentUrl: false }), "history");
});

test("an old popstate does not make a later navigation history", () => {
  assert.equal(resolveMountOrigin({ ...base, lastPopstateAt: base.now - HISTORY_WINDOW_MS - 1 }), "url");
});

test("a document loaded by back_forward at its original URL is history", () => {
  assert.equal(resolveMountOrigin({ ...base, navigationType: "back_forward" }), "history");
});

test("a back_forward document that has since navigated client-side to another ?q= URL is not history", () => {
  assert.equal(resolveMountOrigin({ ...base, navigationType: "back_forward", atInitialDocumentUrl: false }), "url");
});

test("a fresh hero See-all handoff for the same term + mode is hero_see_all", () => {
  assert.equal(
    resolveMountOrigin({ ...base, query: " Wine ", handoff: { term: "wine", mode: "happy_hours", at: base.now - 500 } }),
    "hero_see_all"
  );
});

test("a handoff for another term, another mode, or too old falls back to url", () => {
  assert.equal(resolveMountOrigin({ ...base, handoff: { term: "beer", mode: "happy_hours", at: base.now } }), "url");
  assert.equal(resolveMountOrigin({ ...base, handoff: { term: "wine", mode: "events", at: base.now } }), "url");
  assert.equal(
    resolveMountOrigin({ ...base, handoff: { term: "wine", mode: "happy_hours", at: base.now - HANDOFF_MAX_AGE_MS - 1 } }),
    "url"
  );
});

test("history wins over a leftover handoff (returning via Back after a See-all)", () => {
  assert.equal(
    resolveMountOrigin({ ...base, lastPopstateAt: base.now - 100, handoff: { term: "wine", mode: "happy_hours", at: base.now - 100 } }),
    "history"
  );
});
