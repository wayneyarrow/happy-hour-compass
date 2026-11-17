import { test, before } from "node:test";
import assert from "node:assert/strict";

/**
 * Happy Hours map position restore (src/app/(website)/website-happy-hours/searchMapState.ts):
 * restored only on the Back/Forward that lands on that listing, never after a
 * Back elsewhere followed by an ordinary click, and never across markets.
 * Drives the real module with a minimal fake window (location + popstate).
 */

type Listener = () => void;
const listeners: Listener[] = [];
const fakeWindow = {
  location: { pathname: "/", search: "" },
  addEventListener: (type: string, fn: Listener) => {
    if (type === "popstate") listeners.push(fn);
  },
};
(globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;

let mod: typeof import("../../../src/app/(website)/website-happy-hours/searchMapState");
before(async () => {
  mod = await import("../../../src/app/(website)/website-happy-hours/searchMapState");
});

const SD = { north: 33.2, south: 32.6, east: -116.9, west: -117.4 };
const SD_ZOOMED = { north: 32.8, south: 32.7, east: -117.1, west: -117.2 };
const KEL = { north: 50.0, south: 49.8, east: -119.3, west: -119.6 };

function goTo(pathname: string, search = "") {
  fakeWindow.location = { pathname, search };
}
function back(pathname: string, search = "") {
  goTo(pathname, search);
  for (const fn of listeners) fn();
}
const tick = () => new Promise((r) => setTimeout(r, 1));

test("genuine Back into a listing restores that listing's position", async () => {
  goTo("/greater-san-diego/happy-hours", "?day=monday");
  mod.saveDesktopMapBounds("greater-san-diego", SD_ZOOMED);
  goTo("/greater-san-diego/la-mesa/some-venue"); // ordinary click to a venue
  back("/greater-san-diego/happy-hours", "?day=monday");
  assert.deepEqual(mod.consumeRestoredMapStateIfPopState("greater-san-diego")?.desktopBounds, SD_ZOOMED);
  // A Strict Mode double mount reads it again in the same task.
  assert.deepEqual(mod.consumeRestoredMapStateIfPopState("greater-san-diego")?.desktopBounds, SD_ZOOMED);
  await tick();
  // Consumed: a later ordinary visit to the same URL starts fresh.
  assert.equal(mod.consumeRestoredMapStateIfPopState("greater-san-diego"), null);
});

test("Back elsewhere, then an ordinary click into a listing, opens at the default view (the reported bug)", async () => {
  goTo("/website-happy-hours");
  mod.saveDesktopMapBounds("greater-san-diego", SD); // San Diego browsing on the legacy URL
  goTo("/greater-san-diego/guides/some-guide");
  back("/greater-san-diego"); // unrelated Back to the homepage
  goTo("/"); // switch to Kelowna
  goTo("/website-happy-hours"); // Browse (ordinary click)
  assert.equal(mod.consumeRestoredMapStateIfPopState("central-okanagan"), null);
  assert.equal(mod.consumeRestoredMapStateIfPopState("greater-san-diego"), null, "not even for the market that saved it");
  await tick();
});

test("Back onto the legacy URL never restores another market's position", async () => {
  goTo("/website-happy-hours");
  mod.saveDesktopMapBounds("greater-san-diego", SD);
  goTo("/greater-san-diego/san-diego/some-venue");
  back("/website-happy-hours"); // the saved market has since become Kelowna, so the page now shows Kelowna
  assert.equal(mod.consumeRestoredMapStateIfPopState("central-okanagan"), null);
  await tick();
});

test("each market listing keeps its own position", async () => {
  goTo("/central-okanagan/happy-hours");
  mod.saveDesktopMapBounds("central-okanagan", KEL);
  mod.saveMobileMapBounds("central-okanagan", KEL);
  goTo("/greater-san-diego/happy-hours");
  mod.saveDesktopMapBounds("greater-san-diego", SD);
  back("/central-okanagan/happy-hours");
  const restored = mod.consumeRestoredMapStateIfPopState("central-okanagan");
  assert.deepEqual(restored, { desktopBounds: KEL, mobileBounds: KEL });
  await tick();
  back("/greater-san-diego/happy-hours");
  assert.deepEqual(mod.consumeRestoredMapStateIfPopState("greater-san-diego")?.desktopBounds, SD);
  await tick();
});

test("a fresh visit (no Back at all) never restores", async () => {
  goTo("/greater-san-diego/happy-hours");
  mod.saveDesktopMapBounds("greater-san-diego", SD);
  goTo("/greater-san-diego");
  goTo("/greater-san-diego/happy-hours");
  assert.equal(mod.consumeRestoredMapStateIfPopState("greater-san-diego"), null);
  await tick();
});
