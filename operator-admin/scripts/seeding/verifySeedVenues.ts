/**
 * scripts/seeding/verifySeedVenues.ts — READ-ONLY verification of seed venues against their reviewed CSV.
 *
 * Usage (from operator-admin/):
 *   npx tsx scripts/seeding/verifySeedVenues.ts --csv=<reviewed import csv> --market=<market-slug> \
 *     --stage=draft|prepublish|published \
 *     [--apply-report=<importer apply report json>]      cross-check the stored ids
 *     [--production-base=https://happyhourcompass.com]   check every assigned photo is served and byte-identical
 *     [--snapshot-out=<file.json>]                       write a hash of every venue row (before a write step)
 *     [--snapshot-only]                                  with --snapshot-out: write the snapshot and stop (before import)
 *     [--snapshot-compare=<file.json>]                   prove every venue outside this CSV is unchanged
 *
 * Stages:
 *   draft       after import: rows exist, match the CSV, unpublished seeds, unclaimed/unverified, Free, Search Tags
 *               empty, discovery tags = the importer's generator output, photos present.
 *   prepublish  the gate before the guarded publish: everything in draft, plus unchanged since import
 *               (updated_at = created_at) and a qualifying happy hour.
 *   published   after publish: the same field checks with is_published = true.
 *
 * Only SELECTs (venues, cities, markets, venue_subscriptions, venue_plan_grants). Exit code 1 on any failure.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readSeedCsv } from "../../src/lib/seeding/marketVenueImport";
import { generateSeededTags } from "../../src/lib/seededTags";
import { hasQualifyingHappyHour } from "../../src/lib/venueReadiness";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const fail = (msg: string): never => { console.error(`ERROR: ${msg}`); process.exit(1); };

const csvPath = arg("csv"), market = arg("market"), stage = arg("stage");
if (!csvPath || !market || !stage || !["draft", "prepublish", "published"].includes(stage)) {
  fail("required: --csv=<file> --market=<slug> --stage=draft|prepublish|published");
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
const db = createClient(URL_!, KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

type Row = Record<string, any>;
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const asJson = (x: unknown) => (x === null || x === undefined || x === "" ? null : typeof x === "string" ? JSON.parse(x) : x);

async function allVenueHashes(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("venues").select("*").order("id").range(from, from + 999);
    if (error) fail(`could not read venues: ${error.message}`);
    for (const r of data ?? []) out[r.id] = sha(stable(r));
    if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  const csv = readSeedCsv(fs.readFileSync(path.resolve(csvPath!), "utf8")).rows.map((r) => r.values);
  const slugs = csv.map((r) => r.slug);
  const results: { slug: string; problems: string[] }[] = [];

  if (arg("snapshot-out")) {
    const hashes = await allVenueHashes();
    fs.writeFileSync(path.resolve(arg("snapshot-out")!), JSON.stringify(hashes));
    console.log(`Snapshot of ${Object.keys(hashes).length} venue rows written to ${arg("snapshot-out")}`);
    if (process.argv.includes("--snapshot-only")) process.exit(0);
  }

  const { data: mk, error: mErr } = await db.from("markets").select("id, slug").eq("slug", market!).single();
  if (mErr || !mk) fail(`market ${market} not found`);
  const { data: venues, error: vErr } = await db.from("venues").select("*").in("slug", slugs);
  if (vErr) fail(`could not read venues: ${vErr.message}`);
  const ids = (venues ?? []).map((v) => v.id);
  const [{ data: cities }, { data: subs }, { data: grants }] = await Promise.all([
    db.from("cities").select("id, slug, market_id").eq("market_id", mk!.id),
    ids.length ? db.from("venue_subscriptions").select("venue_id").in("venue_id", ids) : Promise.resolve({ data: [] as Row[] }),
    ids.length ? db.from("venue_plan_grants").select("venue_id").in("venue_id", ids) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const citySlug = new Map((cities ?? []).map((c) => [c.id, c.slug]));
  const bySlug = new Map((venues ?? []).map((v) => [v.slug, v]));
  const subIds = new Set((subs ?? []).map((s) => s.venue_id)), grantIds = new Set((grants ?? []).map((g) => g.venue_id));

  let reportIds: Map<string, string> | null = null;
  if (arg("apply-report")) {
    const rep = JSON.parse(fs.readFileSync(path.resolve(arg("apply-report")!), "utf8"));
    reportIds = new Map((rep.results ?? []).filter((r: Row) => r.outcome === "inserted").map((r: Row) => [r.slug, r.id]));
    if (reportIds.size !== csv.length) results.push({ slug: "(apply report)", problems: [`${reportIds.size} inserted ids for ${csv.length} CSV rows`] });
  }

  for (const c of csv) {
    const p: string[] = [];
    const v = bySlug.get(c.slug);
    if (!v) { results.push({ slug: c.slug, problems: ["no venue with this slug"] }); continue; }
    if (reportIds && reportIds.get(c.slug) !== v.id) p.push(`id ${v.id} differs from apply report ${reportIds.get(c.slug)}`);
    for (const k of ["name", "establishment_type", "address_line1", "city", "region", "postal_code", "country", "phone", "website_url", "menu_url", "place_id", "placeholder_image_path", "hh_times", "hh_tagline"]) {
      if ((v[k] ?? "") !== (c[k] ?? "")) p.push(`${k}: stored ${JSON.stringify(v[k])} vs CSV ${JSON.stringify(c[k])}`);
    }
    for (const k of ["lat", "lng"]) if (Math.abs(Number(v[k]) - Number(c[k])) > 1e-9) p.push(`${k}: ${v[k]} vs ${c[k]}`);
    if (Number(v.google_rating) !== Number(c.google_rating) || Number(v.google_review_count) !== Number(c.google_review_count)) p.push("google rating/review count differ from CSV");
    if (stable(asJson(v.business_hours)) !== stable(asJson(c.business_hours))) p.push("business_hours differ from CSV");
    for (const k of ["hh_food_details", "hh_drink_details"]) if (stable(asJson(v[k])) !== stable(asJson(c[k]))) p.push(`${k} differ from CSV`);
    if (v.market_id !== mk!.id || citySlug.get(v.city_id) !== c.city_slug) p.push(`market/city is ${citySlug.get(v.city_id) ?? v.city_id}, expected ${c.city_slug} in ${market}`);
    if (v.source !== "seed") p.push(`source ${v.source}`);
    if (v.claimed_at || v.claimed_by || v.created_by_operator_id || v.updated_by_operator_id) p.push("claimed or operator-linked");
    if (v.is_verified) p.push("is_verified");
    if (v.cancelled_at) p.push("cancelled");
    if (subIds.has(v.id) || grantIds.has(v.id)) p.push("has a subscription or plan grant (not Free)");
    if ((v.search_tags ?? []).length) p.push(`operator search_tags not empty: ${JSON.stringify(v.search_tags)}`);
    const expectedTags = generateSeededTags({ outdoor_seating: null, live_music: null, good_for_watching_sports: null, good_for_children: null,
      good_for_groups: null, allows_dogs: null, serves_vegetarian_food: null, hh_food_details: c.hh_food_details || null, hh_drink_details: c.hh_drink_details || null } as never);
    if (stable(v.seeded_tags ?? []) !== stable(expectedTags)) p.push(`seeded_tags ${JSON.stringify(v.seeded_tags)} vs generator ${JSON.stringify(expectedTags)}`);
    if (!v.placeholder_image_path || !fs.existsSync(path.join(PUBLIC_DIR, v.placeholder_image_path))) p.push(`photo file missing: public/${v.placeholder_image_path}`);
    const wantPublished = stage === "published";
    if (v.is_published !== wantPublished) p.push(`is_published ${v.is_published}, expected ${wantPublished}`);
    if (stage === "prepublish") {
      if (v.updated_at !== v.created_at) p.push("changed since import (updated_at ≠ created_at)");
      if (!hasQualifyingHappyHour(v.hh_times)) p.push("no qualifying happy hour");
    }
    if (arg("production-base") && v.placeholder_image_path) {
      const res = await fetch(`${arg("production-base")!.replace(/\/$/, "")}/${v.placeholder_image_path}`).catch(() => null);
      const body = res && res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      const local = path.join(PUBLIC_DIR, v.placeholder_image_path);
      if (!res || res.status !== 200 || !(res.headers.get("content-type") ?? "").startsWith("image/jpeg")) p.push(`photo not served: ${res?.status ?? "no response"} ${res?.headers.get("content-type") ?? ""}`);
      else if (fs.existsSync(local) && sha(body!) !== sha(fs.readFileSync(local))) p.push("served photo differs from the repo file");
    }
    results.push({ slug: c.slug, problems: p });
  }

  if (arg("snapshot-compare")) {
    const before: Record<string, string> = JSON.parse(fs.readFileSync(path.resolve(arg("snapshot-compare")!), "utf8"));
    const now = await allVenueHashes();
    const targetIds = new Set(ids);
    const changed = Object.keys(before).filter((id) => !targetIds.has(id) && now[id] !== before[id]);
    const added = Object.keys(now).filter((id) => !(id in before));
    const unexpectedAdds = added.filter((id) => !targetIds.has(id));
    console.log(`Snapshot compare: ${Object.keys(before).length} rows before, ${Object.keys(now).length} now; ${added.length} added (${added.length - unexpectedAdds.length} are this CSV's venues); other rows changed: ${changed.length}`);
    if (changed.length || unexpectedAdds.length) results.push({ slug: "(snapshot)", problems: [`changed outside this CSV: ${changed.join(", ") || "none"}; unexpected new rows: ${unexpectedAdds.join(", ") || "none"}`] });
  }

  let bad = 0;
  for (const r of results) {
    if (r.problems.length) { bad++; console.log(`FAIL  ${r.slug}\n      - ${r.problems.join("\n      - ")}`); }
    else console.log(`PASS  ${r.slug}`);
  }
  console.log(`\n${stage!.toUpperCase()} VERIFY: ${bad ? `${bad} FAILED` : "ALL PASS"} (${csv.length} venues in CSV)`);
  process.exit(bad ? 1 : 0);
})();
