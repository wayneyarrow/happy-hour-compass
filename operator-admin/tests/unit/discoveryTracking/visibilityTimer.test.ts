import { test } from "node:test";
import assert from "node:assert/strict";
import { createVisibilityTimer, VISIBLE_DURATION_MS, VISIBLE_RATIO_THRESHOLD } from "../../../src/lib/discoveryTracking/visibilityTimer";
import { createFakeScheduler } from "./fakeScheduler";

/**
 * The "actually seen" rule behind item_impression / section_exposure
 * (migration 110): ≥50% visible for ≥1 continuous second while the tab is
 * visible, at most once.
 */

function setup(documentVisible = true) {
  const scheduler = createFakeScheduler();
  let fired = 0;
  const timer = createVisibilityTimer({ onQualified: () => fired++, scheduler, documentVisible });
  return { scheduler, timer, fired: () => fired };
}

test("threshold constants are 50% for 1 second", () => {
  assert.equal(VISIBLE_RATIO_THRESHOLD, 0.5);
  assert.equal(VISIBLE_DURATION_MS, 1000);
});

test("qualifies after exactly 1s at ≥50% visibility, not before", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(0.5);
  scheduler.advance(999);
  assert.equal(fired(), 0);
  scheduler.advance(1);
  assert.equal(fired(), 1);
  assert.equal(timer.qualified, true);
});

test("49% visible never qualifies", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(0.49);
  scheduler.advance(10_000);
  assert.equal(fired(), 0);
});

test("scrolling away before 1s resets the clock (no accumulation across interruptions)", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(1);
  scheduler.advance(600);
  timer.setIntersectionRatio(0.2); // scrolled mostly out
  scheduler.advance(5000);
  timer.setIntersectionRatio(0.8); // back in
  scheduler.advance(600); // 1200ms total visible, but not continuous
  assert.equal(fired(), 0);
  scheduler.advance(400);
  assert.equal(fired(), 1);
});

test("fast scroll-past (visible <1s) never qualifies", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(1);
  scheduler.advance(300);
  timer.setIntersectionRatio(0);
  scheduler.advance(10_000);
  assert.equal(fired(), 0);
});

test("hidden tab pauses and resets; visible again restarts the full second", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(1);
  scheduler.advance(700);
  timer.setDocumentVisible(false);
  scheduler.advance(60_000);
  assert.equal(fired(), 0);
  timer.setDocumentVisible(true);
  scheduler.advance(999);
  assert.equal(fired(), 0);
  scheduler.advance(1);
  assert.equal(fired(), 1);
});

test("a page loaded in a background tab does not qualify until the tab is shown", () => {
  const { scheduler, timer, fired } = setup(false);
  timer.setIntersectionRatio(1);
  scheduler.advance(30_000);
  assert.equal(fired(), 0);
  timer.setDocumentVisible(true);
  scheduler.advance(1000);
  assert.equal(fired(), 1);
});

test("qualifies at most once, even if it leaves and re-enters view", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(1);
  scheduler.advance(1000);
  timer.setIntersectionRatio(0);
  timer.setIntersectionRatio(1);
  scheduler.advance(5000);
  assert.equal(fired(), 1);
  assert.equal(scheduler.pending(), 0);
});

test("repeated ratio updates while visible (scroll jitter, re-renders) do not restart the clock", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(0.6);
  scheduler.advance(500);
  timer.setIntersectionRatio(0.75);
  timer.setIntersectionRatio(1);
  scheduler.advance(500);
  assert.equal(fired(), 1);
});

test("dispose (unmount) cancels a pending qualification", () => {
  const { scheduler, timer, fired } = setup();
  timer.setIntersectionRatio(1);
  scheduler.advance(500);
  timer.dispose();
  scheduler.advance(5000);
  assert.equal(fired(), 0);
});
