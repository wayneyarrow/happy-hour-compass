import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildContentCreatedSlackText,
  describeDailySpecialSchedule,
  describeEventSchedule,
  escapeSlackText,
  shouldNotifyContentCreated,
} from "../../../src/lib/customerSuccess/contentCreatedSlack";

/**
 * #customer-success "operator created a Daily Special / Event" notification.
 * Pure builders are tested directly; the create-vs-edit and
 * genuine-vs-platform gating in the two server actions is pinned by
 * source-wiring checks (no live Supabase/Slack in unit tests — nothing here
 * sends a real Slack message).
 */

test("only a genuine, non-impersonated operator session notifies", () => {
  assert.equal(shouldNotifyContentCreated({ isImpersonating: false, operator: { id: "op" } }), true);
  assert.equal(shouldNotifyContentCreated({ isImpersonating: true, operator: { id: "op" } }), false); // Open as Operator
  assert.equal(shouldNotifyContentCreated({ isImpersonating: true, operator: null }), false); // unclaimed support mode (seeded)
  assert.equal(shouldNotifyContentCreated({ isImpersonating: false, operator: null }), false);
});

test("schedule descriptions", () => {
  assert.equal(describeDailySpecialSchedule({ scheduleType: "one_time", oneTimeDate: "2026-09-29" }), "One-time — Tue, Sep 29, 2026");
  assert.equal(
    describeDailySpecialSchedule({ scheduleType: "weekly", daysOfWeek: [2, 4], recurrenceStartDate: null, recurrenceEndDate: "2026-12-31" }),
    "Weekly — Tuesday & Thursday, until Thu, Dec 31, 2026"
  );
  assert.equal(describeEventSchedule({ firstDate: "2026-10-03", recurrence: "none", startTime: "19:00:00" }), "Sat, Oct 3, 2026 at 19:00");
  assert.equal(describeEventSchedule({ firstDate: "2026-10-03", recurrence: "weekly", startTime: null }), "Weekly, starting Sat, Oct 3, 2026");
});

test("message includes venue, title, schedule, and a Control Panel link; escapes operator text", () => {
  const text = buildContentCreatedSlackText({
    kind: "daily_special",
    venueName: "The Placery",
    venueId: "fe324b1e-12cf-4ce6-ac28-2370f2c3e126",
    title: "Trivia, Tacos & Tequila <b>",
    schedule: "One-time — Tue, Sep 29, 2026",
    isPublished: true,
    siteUrl: "https://staging.example.com",
  });
  assert.match(text, /New Daily Special created/);
  assert.match(text, /\*Venue:\* The Placery/);
  assert.match(text, /Trivia, Tacos &amp; Tequila &lt;b&gt;/);
  assert.match(text, /Tue, Sep 29, 2026/);
  assert.match(text, /<https:\/\/staging\.example\.com\/control-panel\/venues\/fe324b1e-12cf-4ce6-ac28-2370f2c3e126\|View venue in Control Panel →>/);
  assert.equal(escapeSlackText("a & <b>"), "a &amp; &lt;b&gt;");
});

// ── Wiring: insert branch only, after the row commits ───────────────────────

const SRC = join(__dirname, "../../../src");

for (const [label, file, updateMarker] of [
  ["Daily Specials", "app/admin/daily-specials/actions.ts", "if (currentSpecialId) {"],
  ["Events", "app/admin/events/actions.ts", "if (currentEventId) {"],
] as const) {
  test(`${label}: notification lives only on the insert path, after the insert, gated on a genuine session`, () => {
    const src = readFileSync(join(SRC, file), "utf8");
    const calls = src.match(/notifyContentCreated\(/g) ?? [];
    assert.equal(calls.length, 1, "exactly one notify call");

    const notifyAt = src.indexOf("notifyContentCreated({");
    const updateBranchAt = src.indexOf(updateMarker);
    const insertAt = src.indexOf(".insert([{");
    assert.ok(updateBranchAt > 0 && insertAt > updateBranchAt, "insert follows the update branch");
    assert.ok(notifyAt > insertAt, "notification is after the insert (never in the update/edit branch)");

    const gate = src.lastIndexOf("if (shouldNotifyContentCreated(ctx))", notifyAt);
    assert.ok(gate > insertAt && gate < notifyAt, "gated on shouldNotifyContentCreated(ctx)");
  });
}
