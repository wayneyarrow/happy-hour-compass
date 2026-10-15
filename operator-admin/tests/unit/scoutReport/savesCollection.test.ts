import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildScoutReport } from "../../../src/lib/scoutReport/buildScoutReport";
import { SAVES_COLLECTION } from "../../../src/lib/scoutReport/definitions";
import { POST as venueSavePost } from "../../../src/app/api/track/venue-save/route";
import { CUR, NOW, TRACKING_STARTS, V, fakeDeps } from "./fixtures";

/**
 * Saves are reported as unavailable (null), not 0, because collection is not
 * established. These tests pin the code facts behind SAVES_COLLECTION — if
 * any of them changes (e.g. the tracking is fixed), a test fails and the
 * assessment must be revisited.
 */

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = (body: unknown) => ({ json: async () => body }) as any;

test("fact: the save-tracking endpoint rejects a venue slug (only a UUID is accepted)", async () => {
  const res = await venueSavePost(req({ venueId: "alpha-bar", action: "save", sessionId: "s" }));
  assert.equal(res.status, 400);
  assert.match(read("app/api/track/venue-save/route.ts"), /!UUID_RE\.test\(venueId\)/);
});

test("fact: the consumer app's BookmarkButton posts the venue's public id, which is its slug", () => {
  const btn = read("app/(consumer)/BookmarkButton.tsx");
  assert.match(btn, /fetch\("\/api\/track\/venue-save"[\s\S]{0,200}venueId,/);
  assert.match(read("lib/data/venues.ts"), /id: \(row\.slug as string\) \?\? ""/, "ConsumerVenue.id is the slug");
  for (const [file, expr] of [["app/(consumer)/VenueList.tsx", "venueId={venue.id}"], ["app/(consumer)/home/VenueRailCard.tsx", "venueId={venue.id}"]] as const) {
    assert.ok(read(file).includes(`<BookmarkButton ${expr}`), `${file} passes ${expr}`);
  }
});

test("fact: the public website's save button never calls the save-tracking endpoint", () => {
  assert.doesNotMatch(read("app/(website)/SaveVenueButton.tsx"), /\/api\/track\/venue-save/);
  // No other website code posts to it either.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.(ts|tsx)$/.test(n) ? [join(dir, n)] : []));
  const hits = walk(join(SRC, "app/(website)")).filter((f) => readFileSync(f, "utf8").includes("/api/track/venue-save"));
  assert.deepEqual(hits, []);
});

test("fact: Operator Admin's Saves figure reads the same table and is unchanged (no Scout code there)", () => {
  const src = read("lib/data/operatorAnalyticsV2.ts");
  assert.match(src, /from\("venue_save_events"\)[\s\S]{0,160}\.eq\("action", "save"\)/);
  assert.doesNotMatch(src, /scoutReport|SAVES_COLLECTION/);
});

test("no save row ever recorded → saves are null with the collection reason, never 0", async () => {
  const { deps } = fakeDeps(); // TRACKING_STARTS.saves = null
  const r = await buildScoutReport({ now: NOW, deps });
  const saves = r.sections.productUsage.data!.saves;
  assert.equal(saves.current.total, null);
  assert.equal(saves.comparison.total, null);
  assert.equal(saves.current.coverage.status, "unavailable");
  assert.equal(saves.current.coverage.note, SAVES_COLLECTION.reason);
  assert.equal(saves.collection.status, "not_established");
  assert.equal(saves.collection.evidence.length, 2);
  assert.equal(r.summary.headlines.saves.current, null);
  // Unavailable is expected, not a failure: the section stays complete and saves are listed as unavailable.
  assert.equal(r.sections.productUsage.status, "complete");
  assert.ok(r.completeness.unavailableMetrics.some((m) => m.metric === "Saves" && m.window === "current" && m.reason === SAVES_COLLECTION.reason));
});

test("isolated recorded saves do not enable the metric: still null, never counted, per-venue saves null too", async () => {
  const { deps } = fakeDeps({
    usage: {
      trackingStarts: async () => ({ ...TRACKING_STARTS, saves: "2026-10-13T20:00:00+00:00" }),
      loadSaveRows: async (w) => (w.startUtc === CUR.startUtc ? [{ id: "sv1", venue_id: V.a }, { id: "sv2", venue_id: V.a }] : []),
    },
  });
  const r = await buildScoutReport({ now: NOW, deps });
  const pu = r.sections.productUsage.data!;
  assert.equal(pu.saves.current.total, null);
  assert.equal(pu.saves.comparison.total, null);
  assert.equal(pu.saves.current.coverage.status, "unavailable");
  assert.equal(pu.saves.current.coverage.note, SAVES_COLLECTION.reason);
  assert.equal(pu.saves.current.coverage.firstRecordedAt, "2026-10-13T20:00:00+00:00", "the recorded row is disclosed, not counted");
  assert.equal(pu.saves.change.absoluteChange, null);
  assert.equal(r.summary.headlines.saves.current, null);
  assert.ok(pu.venues.rows.every((v) => v.saves === null), "no per-venue save counts");
  assert.equal(pu.venues.rows.find((v) => v.venueId === V.a)!.venueViews, 2, "other metrics unaffected");
  assert.ok(r.completeness.unavailableMetrics.some((m) => m.metric === "Saves" && m.window === "current"));
});

test("only an explicit, reviewed status change can enable saves (no data-driven switch exists)", () => {
  assert.equal(SAVES_COLLECTION.status, "not_established");
  const src = read("lib/scoutReport/buildScoutReport.ts");
  assert.match(src, /const savesEstablished = SAVES_COLLECTION\.status === "established";/);
  assert.doesNotMatch(src, /starts\.saves === null \?/, "enabling must not depend on whether rows exist");
  assert.equal(SAVES_COLLECTION.followUp.length, 2);
});
