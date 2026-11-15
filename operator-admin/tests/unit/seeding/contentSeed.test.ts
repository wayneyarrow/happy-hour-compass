import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDays, firstDateOnOrAfter, localToday, to24, eventSlug, expandSeries, endsAfterClose, imageSpacingProblems,
  buildApplySql, buildPublishSql, buildRollbackSql, storageObjectsFor, parseEventInput, parseSpecialInput, readCsv,
} from "../../../src/lib/seeding/contentSeed";

/**
 * Daily Specials + recurring Events seed batches (scripts/seeding/contentSeedBatch.ts; playbook
 * docs/operations/MARKET_CONTENT_SEEDING_PLAYBOOK.md). Pure logic only — no network, no database.
 */

const V = "11111111-1111-4111-8111-111111111111", E1 = "22222222-2222-4222-8222-222222222222", E2 = "33333333-3333-4333-8333-333333333333";
const series = (o: object = {}) => ({ venue_slug: "san-diego-bar", title: "Trivia Night", event_type: "trivia", days: [3], start_time: "7:00 PM", end_time: "9:00 PM",
  description: "d", teaser: null, price_display: null, age_restriction: null, image_slot: "TRIVIA-1", source_url: "https://x", evidence: null, note: null, verified_on: "2026-11-15", ...o });

test("weekdays parse from names, abbreviations and numbers; duplicates and unknowns are refused", () => {
  assert.deepEqual(parseDays("fri;sat"), [5, 6]);
  assert.deepEqual(parseDays("Monday"), [1]);
  assert.deepEqual(parseDays("0"), [0]);
  assert.throws(() => parseDays("fri;friday"), /duplicate/);
  assert.throws(() => parseDays("funday"), /unknown weekday/);
  assert.throws(() => parseDays(""), /no weekdays/);
});

test("first date is the next occurrence on or after the as-of date, which is market-local today", () => {
  assert.equal(firstDateOnOrAfter("2026-11-15", 0), "2026-11-15"); // a Sunday event imported on Sunday starts today
  assert.equal(firstDateOnOrAfter("2026-11-15", 6), "2026-11-21");
  assert.equal(firstDateOnOrAfter("2026-11-15", 1), "2026-11-16");
  // 2026-11-16 04:00 UTC is still Sunday evening in San Diego
  assert.equal(localToday("America/Los_Angeles", new Date("2026-11-16T04:00:00Z")), "2026-11-15");
});

test("event times are stored as the app's text shape; anything else is rejected", () => {
  assert.equal(to24("9:30 PM"), "21:30"); assert.equal(to24("12:00 AM"), "00:00"); assert.equal(to24("12:00 PM"), "12:00");
  assert.equal(to24("21:30"), null); assert.equal(to24("7pm"), null);
});

test("a series on several weekdays expands to one row per weekday with weekday slug suffixes", () => {
  const rows = expandSeries([series({ title: "DJ Night", days: [5, 6] })], "2026-11-15");
  assert.deepEqual(rows.map((r) => [r.weekday, r.slug, r.first_date, r.event_frequency]), [
    [5, "san-diego-bar-dj-night-fridays", "2026-11-20", "Every Friday"],
    [6, "san-diego-bar-dj-night-saturdays", "2026-11-21", "Every Saturday"]]);
  assert.equal(rows[0].event_time, "7:00 PM – 9:00 PM");
  assert.equal(expandSeries([series()], "2026-11-15")[0].slug, "san-diego-bar-trivia-night");
  assert.equal(eventSlug("Venue", "Fun & Games!", 1, false), "venue-fun-games");
});

test("a series whose time differs by day is two input rows; the suffix still applies and weekdays can't repeat", () => {
  const rows = expandSeries([series({ title: "Live Music", days: [6], start_time: "12:00 PM" }), series({ title: "Live Music", days: [0], start_time: "1:00 PM" })], "2026-11-15");
  assert.deepEqual(rows.map((r) => r.slug), ["san-diego-bar-live-music-saturdays", "san-diego-bar-live-music-sundays"]);
  assert.throws(() => expandSeries([series({ days: [3] }), series({ days: [3], start_time: "8:00 PM" })], "2026-11-15"), /weekday is listed twice/);
});

test("end-after-close handles overnight hours and ends", () => {
  assert.equal(endsAfterClose("21:30", "02:00", { open: "16:00", close: "00:00" }), true);  // 2 AM end, midnight close
  assert.equal(endsAfterClose("23:00", "01:00", { open: "17:00", close: "02:00" }), false); // 1 AM end, 2 AM close
  assert.equal(endsAfterClose("11:00", "22:00", { open: "11:00", close: "21:00" }), true);
  assert.equal(endsAfterClose(null, "21:00", { open: "11:00", close: "21:00" }), false);
});

test("image spacing: an image never repeats on the same weekday or at the same venue", () => {
  assert.deepEqual(imageSpacingProblems([{ venue_slug: "a", title: "T", weekday: 3, image_slot: "X-1" }, { venue_slug: "b", title: "T", weekday: 4, image_slot: "X-1" }]), []);
  assert.match(imageSpacingProblems([{ venue_slug: "a", title: "T", weekday: 3, image_slot: "X-1" }, { venue_slug: "b", title: "T", weekday: 3, image_slot: "X-1" }])[0], /Wednesday/);
  assert.match(imageSpacingProblems([{ venue_slug: "a", title: "T1", weekday: 3, image_slot: "X-1" }, { venue_slug: "a", title: "T2", weekday: 4, image_slot: "X-1" }])[0], /at a/);
  // one series on two days shares its image — that's not a clash
  assert.deepEqual(imageSpacingProblems([{ venue_slug: "a", title: "T", weekday: 5, image_slot: "X-1" }, { venue_slug: "a", title: "T", weekday: 6, image_slot: "X-1" }]), []);
});

test("input CSVs must have exactly the documented columns", () => {
  const ok = "venue_slug,title,event_type,days,start_time,end_time,description,teaser,price_display,age_restriction,image_slot,source_url,evidence,note,verified_on\n" +
    'v,"A, B",trivia,wed,7:00 PM,,"say ""hi""",,,,TRIVIA-1,https://x,,,2026-11-15\n';
  const [s] = parseEventInput(ok); assert.equal(s.title, "A, B"); assert.equal(s.description, 'say "hi"'); assert.equal(s.end_time, null); assert.deepEqual(s.days, [3]);
  assert.throws(() => parseEventInput(ok.replace(",verified_on", ",verified")), /missing columns: verified_on/);
  assert.throws(() => parseSpecialInput(ok), /missing columns/);
  assert.equal(readCsv("a,b\n1,\"x\ny\"\n")[0].b, "x\ny");
});

const evBatch = (o: object = {}) => ({ kind: "events" as const, market: "greater-san-diego", rows: [
  { id: E1, venue_id: V, venue_slug: "v", title: "O'Brien's Trivia", slug: "v-obriens-trivia", first_date: "2026-11-18", weekday: 3, start_time: "7:00 PM", end_time: null,
    event_time: "7:00 PM", event_frequency: "Every Wednesday", event_type: "trivia", description: "$1 wings; DROP TABLE x", teaser: null, price_display: null, age_restriction: null,
    image: { storage_path: `events/${E1}/aaaa.jpg`, url: `https://x/storage/v1/object/public/venue-images/events/${E1}/aaaa.jpg` } }], ...o });
const spBatch = { kind: "specials" as const, market: "greater-san-diego", rows: [
  { id: E2, venue_id: V, venue_slug: "v", title: "Taco Tuesday", offer_type: "food", short_summary: "$2 tacos", description: null, conditions: null, days_of_week: [2],
    time_mode: "timed", start_time: "16:00", end_mode: "close", end_time: null, source_url: "https://x", last_verified_at: "2026-11-15T00:00:00Z" }] };

test("draft apply SQL guards every row and inserts unpublished seeded rows in one transaction", () => {
  const sql = buildApplySql(evBatch());
  assert.match(sql, /^BEGIN;$/m); assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /false, true, false\n/); // is_published=false, is_seeded_event=true, is_genuine_operator_engaged=false
  for (const g of ["m.slug = 'greater-san-diego'", "v.is_published", "v.source = 'seed'", "v.claimed_at IS NULL", "v.created_by_operator_id IS NULL", "v.cancelled_at IS NULL",
    "public.event_slug_history", "extract(dow FROM e.first_date) = 3"]) assert.ok(sql.includes(g), g);
  assert.match(sql, /IF c <> 1 THEN RAISE EXCEPTION/);
  assert.ok(sql.includes("$q1$O'Brien's Trivia$q1$"), "values are dollar-quoted, never spliced into single quotes");
  const s = buildApplySql(spBatch);
  assert.ok(s.includes("ARRAY[2]::smallint[]") && s.includes("'16:00'::time") && s.includes("'2026-11-15T00:00:00Z'::timestamptz"));
});

test("publish SQL targets exact IDs, refuses operator-edited rows, requires exactly N and writes one audit row", () => {
  const sql = buildPublishSql(evBatch(), "approver@example.com");
  assert.ok(sql.includes(`t.id IN ('${E1}')`));
  for (const g of ["t.is_published = false", "t.is_seeded_event", "t.created_by_operator_id IS NULL", "t.updated_by_operator_id IS NULL", "IF n <> 1 THEN RAISE EXCEPTION", "'event_bulk_published'"]) assert.ok(sql.includes(g), g);
  assert.ok(buildPublishSql(spBatch, "approver@example.com").includes("'daily_special_bulk_published'"));
  assert.throws(() => buildPublishSql(evBatch(), "not-an-email"), /approver email/);
});

test("rollback deletes only these seeded, never-operator-touched rows and points at the Storage cleanup", () => {
  const sql = buildRollbackSql(evBatch());
  assert.ok(sql.includes(`WHERE id IN ('${E1}') AND is_seeded_event AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL`));
  assert.match(sql, /storage-objects/);
  assert.deepEqual(storageObjectsFor(evBatch()), [`events/${E1}/aaaa.jpg`]);
  assert.throws(() => storageObjectsFor(evBatch({ rows: [{ ...evBatch().rows[0], image: { storage_path: "events/other/x.jpg" } }] })), /under events/);
});

test("SQL builders refuse malformed batches", () => {
  assert.throws(() => buildApplySql(evBatch({ market: "bad market" })), /bad market/);
  assert.throws(() => buildApplySql(evBatch({ rows: [{ ...evBatch().rows[0], id: "x" }] })), /bad id/);
  assert.throws(() => buildApplySql(evBatch({ rows: [evBatch().rows[0], evBatch().rows[0]] })), /duplicate id/);
  assert.throws(() => buildApplySql({ ...spBatch, rows: [{ ...spBatch.rows[0], start_time: "4 PM" }] }), /bad time/);
  assert.throws(() => buildApplySql({ ...spBatch, rows: [{ ...spBatch.rows[0], days_of_week: [7] }] }), /bad days_of_week/);
  assert.throws(() => buildApplySql(evBatch({ rows: [{ ...evBatch().rows[0], title: "x $q9$ y" }] })), /reserved quote tag/);
  assert.throws(() => buildApplySql(evBatch({ rows: [] })), /no rows/);
});

test("release record: the committed Greater San Diego event inputs expand to the published slugs and first dates", () => {
  const dir = join(__dirname, "../../../../docs/operations/greater-san-diego/events-batch1");
  const batch = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
  const rows = expandSeries(parseEventInput(readFileSync(join(dir, "input-events.csv"), "utf8")), batch.asOf);
  assert.equal(rows.length, 39); assert.equal(new Set(rows.map((r) => `${r.venue_slug}|${r.title}`)).size, 33);
  const pub = new Map(batch.rows.map((r: any) => [r.key, r]));
  for (const r of rows) { const p: any = pub.get(r.key); assert.ok(p, r.key); assert.equal(r.slug, p.slug); assert.equal(r.first_date, p.first_date); assert.equal(r.image_slot, p.image.slot); }
  assert.deepEqual(imageSpacingProblems(rows), []);
  const sp = parseSpecialInput(readFileSync(join(dir, "../specials-batch1/input-specials.csv"), "utf8"));
  assert.equal(sp.length, 99);
});
