import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDiscoveryEvent, buildDedupeKey, sanitizeTargetPath } from "../../../src/lib/discoveryTracking/discoveryEvents";

const PV = "11111111-1111-4111-8111-111111111111";
const SEC = "22222222-2222-4222-8222-222222222222";
const VEN = "33333333-3333-4333-8333-333333333333";
const GUIDE = "44444444-4444-4444-8444-444444444444";

const impression = {
  eventType: "item_impression",
  surface: "homepage_section",
  pageViewId: PV,
  sessionId: "sess",
  marketId: "central-okanagan",
  sectionId: SEC,
  sectionKind: "venue_collection",
  itemType: "venue",
  itemId: VEN,
  position: 3,
};

test("a valid homepage impression maps to a row with a once-per-page-view dedupe key", () => {
  const row = validateDiscoveryEvent(impression);
  assert.ok(row);
  assert.equal(row.section_id, SEC);
  assert.equal(row.position, 3);
  assert.equal(row.dedupe_key, `${PV}|item_impression|s:${SEC}|venue:${VEN}`);
});

test("the same item in two placements has different dedupe keys; clicks have none", () => {
  const a = validateDiscoveryEvent(impression)!;
  const b = validateDiscoveryEvent({ ...impression, sectionId: "55555555-5555-4555-8555-555555555555" })!;
  assert.notEqual(a.dedupe_key, b.dedupe_key);
  const click = validateDiscoveryEvent({ ...impression, eventType: "item_click" })!;
  assert.equal(click.dedupe_key, null);
});

test("section exposure: one key per page view + placement", () => {
  const row = validateDiscoveryEvent({
    eventType: "section_exposure", surface: "guide", pageViewId: PV, sessionId: "s", guideId: GUIDE, guideBlock: "venues",
  })!;
  assert.equal(row.dedupe_key, `${PV}|section_exposure|g:${GUIDE}:venues|-`);
});

test("item events require item + position; non-item events must not carry one", () => {
  assert.equal(validateDiscoveryEvent({ ...impression, itemId: undefined }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, position: undefined }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, eventType: "view_all_click" }), null);
});

test("placement identity must match the surface", () => {
  assert.equal(validateDiscoveryEvent({ ...impression, sectionId: undefined }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, guideId: GUIDE }), null);
  assert.equal(
    validateDiscoveryEvent({ eventType: "browse_click", surface: "homepage_hero", pageViewId: PV, sessionId: "s", sectionId: SEC }),
    null
  );
  assert.ok(
    validateDiscoveryEvent({ eventType: "browse_click", surface: "homepage_hero", pageViewId: PV, sessionId: "s", mode: "events", targetPath: "/website-events" })
  );
});

test("rejects unknown enums, non-UUID ids (e.g. a venue slug), bad positions and oversized sessions", () => {
  assert.equal(validateDiscoveryEvent({ ...impression, eventType: "impression" }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, itemType: "operator" }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, itemId: "bar-travelling-man" }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, position: -1 }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, position: 1.5 }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, sessionId: "x".repeat(129) }), null);
  assert.equal(validateDiscoveryEvent({ ...impression, pageViewId: "nope" }), null);
});

test("environment can never be supplied by the client", () => {
  const row = validateDiscoveryEvent({ ...impression, environment: "production" }) as Record<string, unknown>;
  assert.equal("environment" in row, false);
});

test("target paths are same-site paths only, with query/hash stripped", () => {
  assert.equal(sanitizeTargetPath("/collections/patio-picks?x=1#y"), "/collections/patio-picks");
  assert.equal(sanitizeTargetPath("https://evil.example/"), undefined);
  assert.equal(sanitizeTargetPath("//evil.example/"), undefined);
  assert.equal(sanitizeTargetPath(undefined), null);
});

test("buildDedupeKey is null for every non-once event type", () => {
  for (const t of ["item_click", "view_all_click", "browse_click", "suggestion_select"] as const) {
    const row = validateDiscoveryEvent(
      t === "item_click" || t === "suggestion_select"
        ? { ...impression, eventType: t, ...(t === "suggestion_select" ? { surface: "homepage_hero", sectionId: undefined, sectionKind: undefined } : {}) }
        : { eventType: t, surface: "homepage_hero", pageViewId: PV, sessionId: "s" }
    );
    assert.ok(row, t);
    assert.equal(buildDedupeKey(row!), null, t);
  }
});
