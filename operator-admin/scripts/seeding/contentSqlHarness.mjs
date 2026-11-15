// scripts/seeding/contentSqlHarness.mjs — run a content batch's apply / publish / rollback SQL against an in-memory
// PGlite database (NEVER the shared Supabase project). The daily_specials table and its CHECK constraints are copied
// verbatim from supabase/migrations/091_daily_specials_foundation.sql; events / event_slug_history / venues / audit_logs are
// minimal replicas with the real UNIQUE slug, event_type CHECK and guard-relevant columns.
// Checks: apply inserts N drafts; re-run refused; publish sets exactly N + one audit row; re-run refused; rollback empties;
// a venue claimed before apply → whole apply refused; an operator-edited draft → whole publish refused and rollback keeps it;
// (events) a slug already in event_slug_history → apply refused.
//
// PGlite is not a project dependency. From operator-admin/:   npm i --no-save @electric-sql/pglite
//   node scripts/seeding/contentSqlHarness.mjs ../docs/operations/<market>/<events batch dir> ../docs/operations/<market>/<specials batch dir>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
const dirs = process.argv.slice(2);
if (!dirs.length) { console.error("usage: node scripts/seeding/contentSqlHarness.mjs <batch dir> [<batch dir> ...]"); process.exit(1); }
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let PGlite;
try { ({ PGlite } = await import(createRequire(join(process.cwd(), "package.json")).resolve("@electric-sql/pglite"))); }
catch { console.error("PGlite not installed — run `npm i --no-save @electric-sql/pglite` in operator-admin/ (it is not a project dependency)"); process.exit(2); }
const mig = readFileSync(join(repo, "supabase/migrations/091_daily_specials_foundation.sql"), "utf8");
const fn = mig.match(/CREATE OR REPLACE FUNCTION public\.array_has_duplicate_smallints[\s\S]*?\n\$\$;/)[0];
const table = mig.match(/CREATE TABLE IF NOT EXISTS public\.daily_specials \([\s\S]*?\n\);/)[0].replace(/REFERENCES public\.\w+\(id\)( ON DELETE \w+( \w+)?)?/g, "");
const checks = [...mig.matchAll(/ALTER TABLE public\.daily_specials\s+ADD CONSTRAINT[\s\S]*?;\n/g)].map((m) => m[0]);
let pass = 0, fail = 0; const ck = (n, p, d = "") => { p ? pass++ : fail++; console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
async function fresh(batch, mutate) {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA IF NOT EXISTS public;
    CREATE TABLE public.markets (id uuid PRIMARY KEY, slug text UNIQUE);
    CREATE TABLE public.venues (id uuid PRIMARY KEY, slug text, market_id uuid, is_published boolean, source text, claimed_at timestamptz, claimed_by uuid,
      created_by_operator_id uuid, updated_by_operator_id uuid, cancelled_at timestamptz);
    CREATE TABLE public.operators (id uuid PRIMARY KEY);
    CREATE TABLE public.audit_logs (id serial PRIMARY KEY, actor_email text NOT NULL, action text NOT NULL, entity_type text NOT NULL, entity_id text, entity_name text, details_json jsonb);
    CREATE TABLE public.events (id uuid PRIMARY KEY, venue_id uuid NOT NULL, title text NOT NULL, slug text UNIQUE NOT NULL, first_date date, start_time text, end_time text,
      event_time text, event_frequency text, recurrence text NOT NULL DEFAULT 'none', event_type text NOT NULL DEFAULT 'other'
        CHECK (event_type IN ('live_music','dj_dance','trivia','karaoke','comedy','sports','food_drink','wine_tasting','community','other')),
      description text, teaser text, price_display text, age_restriction text, image_url text, is_published boolean NOT NULL DEFAULT false,
      is_seeded_event boolean NOT NULL DEFAULT false, is_genuine_operator_engaged boolean NOT NULL DEFAULT false, created_by_operator_id uuid, updated_by_operator_id uuid);
    CREATE TABLE public.event_slug_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, old_slug text UNIQUE NOT NULL);
    ${fn}
    ${table}
    ALTER TABLE public.daily_specials ADD COLUMN is_genuine_operator_engaged boolean NOT NULL DEFAULT false;
    ${checks.join("\n")}
    INSERT INTO public.markets VALUES ('00000000-0000-4000-8000-000000000900', '${batch.market}');`);
  for (const id of new Set(batch.rows.map((r) => r.venue_id)))
    await db.query(`INSERT INTO public.venues (id, slug, market_id, is_published, source) VALUES ($1, $2, '00000000-0000-4000-8000-000000000900', true, 'seed')`, [id, "v-" + id]);
  if (mutate) await mutate(db);
  return db;
}
const run = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { await db.exec("ROLLBACK").catch(() => {}); return e.message; } };
for (const dir of dirs) {
  const batch = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
  const T = batch.kind === "events" ? "events" : "daily_specials";
  const apply = readFileSync(join(dir, "apply.sql"), "utf8"), publish = readFileSync(join(dir, "publish.sql"), "utf8"), rollback = readFileSync(join(dir, "rollback.sql"), "utf8");
  const N = (apply.match(/GET DIAGNOSTICS c = ROW_COUNT/g) || []).length;
  console.log(`\n== ${batch.kind}: ${N} rows in apply.sql`);
  const cnt = async (db, w = "true") => (await db.query(`SELECT count(*)::int n FROM public.${T} WHERE ${w}`)).rows[0].n;
  { const db = await fresh(batch); const e = await run(db, apply);
    ck("apply runs (real CHECK constraints)", !e, e ?? ""); ck(`apply inserts exactly ${N} drafts`, (await cnt(db, "NOT is_published")) === N && (await cnt(db)) === N);
    const e2 = await run(db, apply); ck("re-running apply is refused (duplicate guard), nothing added", !!e2 && (await cnt(db)) === N, e2?.slice(0, 80));
    const e3 = await run(db, publish); ck("publish runs", !e3, e3 ?? ""); ck(`publish sets exactly ${N} published`, (await cnt(db, "is_published")) === N);
    const a = (await db.query(`SELECT action, (details_json->>'count')::int n FROM public.audit_logs`)).rows; ck("one audit row with the count", a.length === 1 && a[0].n === N, JSON.stringify(a));
    const e4 = await run(db, publish); ck("re-running publish is refused, no second audit row", !!e4 && (await db.query(`SELECT count(*)::int n FROM public.audit_logs`)).rows[0].n === 1);
    const e5 = await run(db, rollback); ck("rollback deletes all batch rows", !e5 && (await cnt(db)) === 0, e5 ?? ""); }
  { const victim = batch.rows[0].venue_id;
    const db = await fresh(batch, (d) => d.query(`UPDATE public.venues SET claimed_at = now() WHERE id = $1`, [victim]));
    const e = await run(db, apply); ck("a venue claimed before apply → whole apply refused, 0 rows", !!e && (await cnt(db)) === 0, e?.slice(0, 90)); }
  { const db = await fresh(batch); await run(db, apply);
    await db.query(`UPDATE public.${T} SET updated_by_operator_id = gen_random_uuid() WHERE id = $1`, [batch.rows[0].id]);
    const e = await run(db, publish); ck("an operator-edited draft → whole publish refused, nothing published", !!e && (await cnt(db, "is_published")) === 0, e?.slice(0, 90));
    await run(db, rollback); ck("rollback leaves the operator-edited row", (await cnt(db)) === 1); }
  if (batch.kind === "events") { const db = await fresh(batch, async (d) => { const r = batch.rows[0];
      await d.query(`INSERT INTO public.event_slug_history (event_id, old_slug) VALUES (gen_random_uuid(), $1)`, [r.slug]); });
    const e = await run(db, apply); ck("slug already in event_slug_history → apply refused", !!e && (await cnt(db)) === 0, e?.slice(0, 90)); }
}
console.log(`\n${pass}/${pass + fail} checks passed`); if (fail) process.exit(1);
