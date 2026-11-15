import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildGuardedPublishSql, planPublishTargets } from "../../../src/lib/seeding/guardedPublishSql";

/**
 * Market-seeding tools (operator-admin/scripts/seeding/, playbook Step 5): the guarded publish SQL keeps every
 * safeguard from the Greater San Diego rollout, the publish targets must match the reviewed CSV exactly, the read-only
 * tools never write, and every logged-out Production check blocks analytics. No network, no database.
 */

const ID1 = "e9f4a0dd-0672-44ae-83ce-e6dac83497fe", ID2 = "6e2a112d-b0b2-4990-a66c-53fe5935cec8";
const CSV = [
  { slug: "san-diego-ob-surf-lodge", city_slug: "san-diego", market_slug: "greater-san-diego" },
  { slug: "chula-vista-the-cheesecake-factory-otay-ranch", city_slug: "chula-vista", market_slug: "greater-san-diego" },
];
const report = (results: object[], extra: object = {}) => ({ mode: "apply", market: "greater-san-diego", results, ...extra });
const INSERTED = [
  { rowNumber: 2, slug: CSV[0].slug, outcome: "inserted", id: ID1 },
  { rowNumber: 3, slug: CSV[1].slug, outcome: "inserted", id: ID2 },
];
const OPTS = { marketSlug: "greater-san-diego", marketName: "Greater San Diego", batchLabel: "gsd-test", approverEmail: "approver@example.com" };

test("publish targets pair exact apply-report ids with the reviewed CSV and its expected cities", () => {
  const { targets, errors } = planPublishTargets(report(INSERTED), CSV, "greater-san-diego");
  assert.deepEqual(errors, []);
  assert.deepEqual(targets, [
    { id: ID1, slug: CSV[0].slug, citySlug: "san-diego" },
    { id: ID2, slug: CSV[1].slug, citySlug: "chula-vista" },
  ]);
});

test("publish targets refuse anything that is not an exact match", () => {
  const bad = (rep: object, csv = CSV, market = "greater-san-diego") => planPublishTargets(rep, csv, market);
  assert.ok(bad({ ...report(INSERTED), mode: "dry-run" }).errors.length, "dry-run report");
  assert.ok(bad(report(INSERTED.slice(0, 1))).errors.some((e) => e.includes("no inserted id")), "CSV row missing from report");
  assert.ok(bad(report([...INSERTED, { slug: "san-diego-extra", outcome: "inserted", id: "11111111-1111-4111-8111-111111111111" }])).errors.some((e) => e.includes("not in the reviewed CSV")), "extra report row");
  assert.ok(bad(report([INSERTED[0], { ...INSERTED[1], id: ID1 }])).errors.some((e) => e.includes("twice")), "duplicate id");
  assert.ok(bad(report([INSERTED[0], { ...INSERTED[1], id: "not-a-uuid" }])).errors.length, "invalid id");
  assert.ok(bad(report(INSERTED), CSV, "central-okanagan").errors.length, "wrong market");
  assert.ok(bad(report(INSERTED), [CSV[0], { ...CSV[1], market_slug: "central-okanagan" }]).errors.length, "row in another market");
  assert.deepEqual(bad(report(INSERTED.slice(0, 1))).targets, [], "no partial target list on error");
});

test("guarded publish SQL keeps every safeguard: exact ids + cities, seed/owner/verified checks, row-count guard, audit event", () => {
  const { targets } = planPublishTargets(report(INSERTED), CSV, "greater-san-diego");
  const sql = buildGuardedPublishSql(targets, OPTS);
  assert.match(sql, /^-- Guarded publish/);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.ok(sql.includes(`('${ID1}'::uuid, 'san-diego')`) && sql.includes(`('${ID2}'::uuid, 'chula-vista')`));
  assert.match(sql, /SET is_published = true\n/);
  assert.equal((sql.match(/SET /g) ?? []).length, 1, "only is_published is set");
  for (const guard of ["v.is_published = false", "v.created_by_operator_id IS NULL", "v.updated_by_operator_id IS NULL", "v.claimed_at IS NULL",
    "v.claimed_by IS NULL", "v.is_verified = false", "v.cancelled_at IS NULL", "v.source = 'seed'", "m.slug = 'greater-san-diego'",
    "c.slug = t.city_slug", "v.placeholder_image_path IS NOT NULL", "v.hh_times IS NOT NULL"]) assert.ok(sql.includes(guard), guard);
  assert.match(sql, /IF n <> 2 THEN RAISE EXCEPTION 'expected exactly 2 venues published/);
  assert.match(sql, /INSERT INTO public\.audit_logs[\s\S]*VALUES \('approver@example\.com', 'venue_bulk_published', 'venue_batch'[\s\S]*'count', 2[\s\S]*'batch', 'gsd-test'/);
  assert.ok(sql.includes(`jsonb_build_array('${ID1}', '${ID2}')`));
  assert.equal(/\b(DELETE|TRUNCATE|DROP|ALTER)\b/i.test(sql), false);
});

test("guarded publish SQL refuses unsafe input", () => {
  const t = [{ id: ID1, slug: "x", citySlug: "san-diego" }];
  assert.throws(() => buildGuardedPublishSql([], OPTS));
  assert.throws(() => buildGuardedPublishSql([{ ...t[0], id: "1; DROP TABLE venues" }], OPTS));
  assert.throws(() => buildGuardedPublishSql([{ ...t[0], citySlug: "x'; --" }], OPTS));
  assert.throws(() => buildGuardedPublishSql([t[0], t[0]], OPTS));
  assert.throws(() => buildGuardedPublishSql(t, { ...OPTS, marketSlug: "Bad Market" }));
  assert.throws(() => buildGuardedPublishSql(t, { ...OPTS, batchLabel: "x'; drop" }));
  assert.throws(() => buildGuardedPublishSql(t, { ...OPTS, approverEmail: "nope" }));
  assert.match(buildGuardedPublishSql(t, { ...OPTS, marketName: "O'Brien Coast" }), /'O''Brien Coast'/, "market name is escaped");
});

const TOOLS = join(__dirname, "../../../scripts/seeding");
const read = (f: string) => readFileSync(join(TOOLS, f), "utf8");

test("read-only seeding tools never write to the database", () => {
  for (const f of ["verifySeedVenues.ts", "exportSeedState.ts", "checkDraftsHidden.ts", "checkPublishedVenues.ts", "buildGuardedPublishSql.ts"]) {
    const src = read(f);
    assert.equal(/\.from\([^)]*\)[\s\S]{0,40}?\.(insert|update|upsert|delete)\(/.test(src) || /\.rpc\(/.test(src), false, `${f} has a database write call`);
  }
  assert.equal(/createClient/.test(read("buildGuardedPublishSql.ts")), false, "the SQL builder never connects");
});

test("every logged-out Production check blocks analytics in the page and at the network", () => {
  for (const f of ["checkDraftsHidden.ts", "checkPublishedVenues.ts"]) {
    const s = read(f);
    assert.match(s, /from "\.\/analyticsBlock"/, f);
    assert.match(s, /await blockAnalytics\(ctx\)/, f);
    assert.match(s, /tracking requests reached the network layer/, f);
  }
  const block = read("analyticsBlock.ts");
  assert.match(block, /addInitScript\(ANALYTICS_INIT_SCRIPT\)/);
  assert.match(block, /ctx\.route\(ANALYTICS_ROUTE/);
  assert.match(block, /\/api\\\/track\\\/\|google-analytics/);
});

test("seeding tools carry no machine-specific paths or credentials", () => {
  for (const f of readdirSync(TOOLS, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)) {
    const s = read(f);
    assert.equal(/\/home\/|hhc-work|\/tmp\/claude/.test(s.replace(/e\.g\. ~\/hhc-work[^\s)]*/g, "")), false, `${f} has a machine-specific path`);
    assert.equal(/(sk_live|AIza[0-9A-Za-z_-]{20,}|eyJhbGciOi)/.test(s), false, `${f} embeds a credential`);
  }
});
