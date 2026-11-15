/**
 * scripts/seeding/contentSeedBatch.ts — seed batches of DAILY SPECIALS and recurring EVENTS for already-seeded venues.
 * Playbook: docs/operations/MARKET_CONTENT_SEEDING_PLAYBOOK.md (read it first). Pure logic: src/lib/seeding/contentSeed.ts.
 *
 * Commands (run from operator-admin/):
 *   build          --kind=events|specials --input=<input csv> --market=<slug> --out=<batch dir>
 *                  (--as-of=YYYY-MM-DD | --timezone=<IANA zone>) [--images=<prep-report.json>] [--replace-slots=A,B]
 *                  [--reuse=<previous batch.json>] [--offline]
 *   dry-run        --batch=<dir>/batch.json --approver=<email> [--images-dir=<prepared images dir>]   (DB read-only; writes SQL files)
 *   sql            --batch=<dir>/batch.json --approver=<email>          (offline; writes apply.sql / publish.sql / rollback.sql)
 *   replay         --dir=<batch dir> --approver=<email>                 (offline; rebuild from input CSV + compare with committed records)
 *   image-manifest --batch=<dir>/batch.json --sources=<sources csv>     (offline; writes <dir>/image-manifest.csv)
 *   upload-images  --batch=<dir>/batch.json --images-dir=<dir> [--apply]   (events; Storage write ONLY with --apply)
 *   verify         --batch=<dir>/batch.json --stage=images|draft|published [--ids=<imported-ids.txt>]   (read-only)
 *   storage-objects --batch=<dir>/batch.json [--remove --apply]          (lists an event batch's Storage objects; with
 *                  --remove --apply deletes only objects whose event row no longer exists, i.e. after a rollback)
 *
 * Writes to the database or Storage happen ONLY through `upload-images --apply`, `storage-objects --remove --apply`, or
 * by running the generated SQL with `supabase db query --linked -f <file>` — each only after explicit approval.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateDailySpecialSchedule, validateDailySpecialTime, validateDailySpecialContent } from "../../src/lib/dailySpecialSchedule";
import { EVENT_TYPE_DEFS } from "../../src/lib/eventTypes";
import {
  WEEKDAYS, WEEKDAY_TITLES, expandSeries, firstDateOnOrAfter, weekdayOf, localToday, to24, endsAfterClose, imageSpacingProblems,
  buildApplySql, buildPublishSql, buildRollbackSql, storageObjectsFor, parseEventInput, parseSpecialInput, readCsv, csvCell,
} from "../../src/lib/seeding/contentSeed";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => process.argv.includes(`--${n}`);
const fail = (m: string): never => { console.error(`ERROR: ${m}`); process.exit(1); };
const BUCKET = "venue-images";
const EVENT_TYPES = new Set<string>(EVENT_TYPE_DEFS.map((d) => d.key));
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_db) return _db;
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL, k = process.env.SUPABASE_SECRET_KEY;
  if (!u || !k) fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in operator-admin/.env.local (needed for this command)");
  return (_db = createClient(u!, k!, { auth: { autoRefreshToken: false, persistSession: false } }));
}
const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? fail("NEXT_PUBLIC_SUPABASE_URL needed to form image URLs (or use --reuse)");
const readBatch = () => { const f = arg("batch") ?? fail("--batch=<dir>/batch.json required"); return { file: f!, dir: path.dirname(f!), batch: JSON.parse(fs.readFileSync(f!, "utf8")) }; };
const imageFile = (img: any) => img?.file ?? (img?.local ? path.basename(img.local) : null);

type Venue = { id: string; slug: string; name: string; market_id: string; is_published: boolean; source: string; claimed_at: string | null; claimed_by: string | null;
  created_by_operator_id: string | null; cancelled_at: string | null; business_hours: Record<string, { open: string; close: string } | null> | null; hh_times: string | null; cities: { slug: string; name: string } };
async function loadVenues(slugs: string[], marketSlug: string) {
  const { data: mk } = await db().from("markets").select("id, slug").eq("slug", marketSlug).single();
  if (!mk) fail(`market ${marketSlug} not found`);
  const { data, error } = await db().from("venues").select("id, slug, name, market_id, is_published, source, claimed_at, claimed_by, created_by_operator_id, cancelled_at, business_hours, hh_times, cities(slug, name)").in("slug", slugs);
  if (error) fail(error.message);
  return { market: mk!, venues: new Map((data as unknown as Venue[]).map((v) => [v.slug, v])) };
}
function venueProblems(v: Venue | undefined, marketId: string): string[] {
  if (!v) return ["venue not found"]; const p: string[] = [];
  if (v.market_id !== marketId) p.push("venue not in market"); if (!v.is_published) p.push("venue not published");
  if (v.source !== "seed") p.push(`venue source is ${v.source}, not seed`); if (v.claimed_at || v.claimed_by || v.created_by_operator_id) p.push("venue is claimed/operator-owned");
  if (v.cancelled_at) p.push("venue cancelled"); return p;
}

// ─────────────────────────────── build ───────────────────────────────
async function build() {
  const kind = arg("kind"), input = arg("input"), market = arg("market"), out = arg("out");
  if (!kind || !input || !market || !out || !["events", "specials"].includes(kind)) fail("build needs --kind=events|specials --input=<csv> --market --out");
  const asOf = arg("as-of") ?? (arg("timezone") ? localToday(arg("timezone")!) : fail("give --as-of=YYYY-MM-DD or --timezone=<market IANA zone> (first dates use market-local today)"));
  const reuse = arg("reuse") ? JSON.parse(fs.readFileSync(arg("reuse")!, "utf8")) : null;
  const prev = new Map<string, any>((reuse?.rows ?? []).map((r: any) => [r.key, r]));
  const offline = flag("offline"); if (offline && !reuse) fail("--offline needs --reuse (venue IDs, names and cities come from the previous batch)");
  const text = fs.readFileSync(input!, "utf8");
  const items: any[] = kind === "events" ? parseEventInput(text) : parseSpecialInput(text);
  const venueInfo = async () => {
    if (offline) { const m = new Map<string, any>(); for (const r of reuse.rows) m.set(r.venue_slug, { id: r.venue_id, name: r.venue_name, city: r.city }); return m; }
    const { venues } = await loadVenues([...new Set(items.map((x) => x.venue_slug))], market!);
    return new Map([...venues].map(([s, v]) => [s, { id: v.id, name: v.name, city: v.cities?.name ?? null }]));
  };
  const V = await venueInfo(); const rows: any[] = [];
  if (kind === "events") {
    const prep = arg("images") ? JSON.parse(fs.readFileSync(arg("images")!, "utf8")) : null;
    const img = new Map<string, any>((prep?.images ?? []).map((i: any) => [i.slot, i]));
    const replace = new Set((arg("replace-slots") ?? "").split(",").filter(Boolean));
    for (const e of expandSeries(items, asOf)) {
      const p = prev.get(e.key); const v = V.get(e.venue_slug); if (!v) fail(`venue ${e.venue_slug} not found${offline ? " in --reuse batch" : ""}`);
      const id = p?.id ?? crypto.randomUUID(); const storage_path = p?.image?.storage_path ?? `events/${id}/${crypto.randomUUID()}.jpg`;
      const i = img.get(e.image_slot); const prevImg = p?.image?.slot === e.image_slot ? p.image : null;
      const file = i?.preparedName ?? imageFile(prevImg); const s256 = i?.preparedSha256 ?? prevImg?.sha256 ?? null;
      const base = p?.image?.url ? p.image.url.slice(0, p.image.url.indexOf("/storage/v1/")) : supabaseUrl();
      const { key, image_slot, ...rest } = e;
      rows.push({ key, id, venue_id: v.id, venue_name: v.name, city: v.city, ...rest,
        image: { slot: image_slot, status: !file ? "missing" : replace.has(image_slot) ? "replace" : "ok", file, sha256: s256, storage_path, url: `${base}/storage/v1/object/public/${BUCKET}/${storage_path}` },
        is_published: false, is_seeded_event: true, is_genuine_operator_engaged: false });
    }
  } else {
    for (const s of items) {
      const key = `${s.venue_slug}|${s.title}`; const p = prev.get(key); const v = V.get(s.venue_slug); if (!v) fail(`venue ${s.venue_slug} not found`);
      const { verified_on, ...rest } = s;
      rows.push({ key, id: p?.id ?? crypto.randomUUID(), venue_id: v.id, venue_name: v.name, city: v.city, venue_slug: s.venue_slug, title: s.title, offer_type: s.offer_type,
        short_summary: s.short_summary, description: s.description, conditions: s.conditions, schedule_type: "weekly", days_of_week: s.days_of_week, time_mode: s.time_mode,
        start_time: s.start_time, end_mode: s.end_mode, end_time: s.end_time, is_published: false, is_seeded_special: true, is_genuine_operator_engaged: false,
        source_url: s.source_url, last_verified_at: `${verified_on}T00:00:00Z`, evidence: rest.evidence, note: rest.note, decision: rest.decision });
    }
  }
  fs.mkdirSync(out!, { recursive: true });
  const held = arg("held") ? readCsv(fs.readFileSync(arg("held")!, "utf8")) : reuse?.held ?? [];
  const batch = { kind, market, asOf, generatedAt: new Date().toISOString(), held, excluded: reuse?.excluded ?? [], rows };
  fs.writeFileSync(path.join(out!, "batch.json"), JSON.stringify(batch, null, 1) + "\n");
  writeReviewCsv(batch, path.join(out!, "review.csv"));
  if (kind === "events") for (const p of imageSpacingProblems(rows.map((r) => ({ venue_slug: r.venue_slug, title: r.title, weekday: r.weekday, image_slot: r.image.slot })))) console.log(`  image spacing: ${p}`);
  console.log(`Built ${rows.length} ${kind} rows${kind === "events" ? ` (${new Set(rows.map((r) => `${r.venue_slug}|${r.title}`)).size} series)` : ""} as-of ${asOf} → ${path.join(out!, "batch.json")}`);
}
function writeReviewCsv(batch: any, file: string) {
  const cols = batch.kind === "events"
    ? ["id", "city", "venue_name", "venue_id", "title", "slug", "event_type", "recurrence", "event_frequency", "first_date", "start_time", "end_time", "event_time", "price_display", "age_restriction", "description", "image_slot", "image_status", "storage_path", "source_url", "verified_on", "note"]
    : ["id", "city", "venue_name", "venue_id", "title", "offer_type", "days_of_week", "time_mode", "start_time", "end_mode", "end_time", "short_summary", "description", "conditions", "source_url", "last_verified_at", "decision", "note"];
  const L = [cols.join(",")];
  for (const r of batch.rows) L.push(cols.map((c) => csvCell(c === "image_slot" ? r.image?.slot : c === "image_status" ? r.image?.status : c === "storage_path" ? r.image?.storage_path : c === "days_of_week" ? `{${r.days_of_week.join(",")}}` : r[c])).join(","));
  fs.writeFileSync(file, L.join("\n") + "\n");
}
function writeSql(batch: any, dir: string, rows: any[], approver: string) {
  const b = { kind: batch.kind, market: batch.market, rows };
  fs.writeFileSync(path.join(dir, "apply.sql"), buildApplySql(b)); fs.writeFileSync(path.join(dir, "publish.sql"), buildPublishSql(b, approver)); fs.writeFileSync(path.join(dir, "rollback.sql"), buildRollbackSql(b));
}

// ─────────────────────────────── dry run (DB read-only) ───────────────────────────────
async function dryRun() {
  const { batch, dir } = readBatch(); const approver = arg("approver") ?? fail("--approver=<email> (recorded in the publish audit row)");
  const imagesDir = arg("images-dir");
  const { market, venues } = await loadVenues([...new Set(batch.rows.map((r: any) => r.venue_slug))] as string[], batch.market);
  const vids = [...new Set([...venues.values()].map((v) => v.id))];
  const errors: string[] = [], warnings: string[] = [], perRow: any[] = []; const seenIds = new Set<string>();
  const dupId = (id: string) => { if (seenIds.has(id)) return true; seenIds.add(id); return false; };
  if (batch.kind === "events") {
    const { data: existing } = await db().from("events").select("id, venue_id, title").in("venue_id", vids);
    const slugs = batch.rows.map((r: any) => r.slug);
    const { data: slugHits } = await db().from("events").select("id, slug").in("slug", slugs);
    const { data: histHits } = await db().from("event_slug_history").select("old_slug").in("old_slug", slugs);
    const { data: idHits } = await db().from("events").select("id").in("id", batch.rows.map((r: any) => r.id));
    const seenSlug = new Set<string>(), seenKey = new Set<string>();
    for (const r of batch.rows) {
      const p: string[] = [], w: string[] = []; const v = venues.get(r.venue_slug); p.push(...venueProblems(v, market.id));
      if (v && v.id !== r.venue_id) p.push("venue_id mismatch");
      if (!EVENT_TYPES.has(r.event_type)) p.push(`bad event_type ${r.event_type}`);
      if (weekdayOf(r.first_date) !== r.weekday) p.push("first_date weekday mismatch");
      if (r.first_date < batch.asOf || r.first_date !== firstDateOnOrAfter(batch.asOf, r.weekday)) p.push("first_date is not the next occurrence on/after as-of");
      if (!to24(r.start_time)) p.push(`bad start_time ${r.start_time}`); if (r.end_time && !to24(r.end_time)) p.push(`bad end_time ${r.end_time}`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug) || !r.slug.startsWith(r.venue_slug + "-")) p.push(`bad slug ${r.slug}`);
      if (seenSlug.has(r.slug)) p.push("duplicate slug in batch"); seenSlug.add(r.slug); if (dupId(r.id)) p.push("duplicate id in batch");
      if ((slugHits ?? []).some((x: any) => x.slug === r.slug)) p.push("slug already used in events");
      if ((histHits ?? []).some((x: any) => x.old_slug === r.slug)) p.push("slug in event_slug_history");
      if ((idHits ?? []).some((x: any) => x.id === r.id)) p.push("id already exists");
      const k = `${r.venue_id}|${r.title.toLowerCase()}|${r.weekday}`; if (seenKey.has(k)) p.push("duplicate venue/title/weekday in batch"); seenKey.add(k);
      const dupe = (existing ?? []).find((x: any) => x.venue_id === r.venue_id && x.title.toLowerCase() === r.title.toLowerCase()); if (dupe) p.push(`existing event with same title at venue (${dupe.id})`);
      if (!r.description) w.push("no description");
      const bh = v?.business_hours?.[WEEKDAYS[r.weekday]];
      if (v && !bh) p.push("venue closed that day"); else if (bh && to24(r.start_time)) { const s = to24(r.start_time)!; const cl = bh.close <= bh.open ? "24:00" : bh.close; if (!(s >= bh.open && s < cl)) w.push(`starts ${s} outside hours ${bh.open}–${bh.close}`); }
      if (bh && r.end_time && to24(r.end_time) && endsAfterClose(to24(r.start_time), to24(r.end_time)!, bh)) p.push(`ends ${r.end_time} after venue close ${bh.close}`);
      if (r.image.status !== "ok") p.push(`image ${r.image.slot} ${r.image.status}`);
      else if (imagesDir) { const f = path.join(imagesDir, imageFile(r.image) ?? ""); if (!fs.existsSync(f) || sha(fs.readFileSync(f)) !== r.image.sha256) p.push(`image ${r.image.slot} local file missing or changed (${f})`); }
      if (!r.image.storage_path?.startsWith(`events/${r.id}/`)) p.push("storage path not under events/<eventId>/");
      perRow.push({ id: r.id, slug: r.slug, title: r.title, weekday: WEEKDAY_TITLES[r.weekday], errors: p, warnings: w });
      if (p.length) errors.push(`${r.slug}: ${p.join("; ")}`); if (w.length) warnings.push(`${r.slug}: ${w.join("; ")}`);
    }
    for (const sp of imageSpacingProblems(batch.rows.map((r: any) => ({ venue_slug: r.venue_slug, title: r.title, weekday: r.weekday, image_slot: r.image.slot })))) warnings.push(`image spacing: ${sp}`);
    if (!imagesDir) warnings.push("local image files not checked (pass --images-dir to check them before upload)");
  } else {
    const { data: existing } = await db().from("daily_specials").select("id, venue_id, title").in("venue_id", vids);
    const { data: idHits } = await db().from("daily_specials").select("id").in("id", batch.rows.map((r: any) => r.id));
    const seenKey = new Set<string>();
    for (const r of batch.rows) {
      const p: string[] = [], w: string[] = []; const v = venues.get(r.venue_slug); p.push(...venueProblems(v, market.id));
      if (v && v.id !== r.venue_id) p.push("venue_id mismatch");
      for (const res of [validateDailySpecialSchedule({ scheduleType: r.schedule_type, oneTimeDate: null, daysOfWeek: r.days_of_week, recurrenceStartDate: null, recurrenceEndDate: null }),
        validateDailySpecialTime({ timeMode: r.time_mode, startTime: r.start_time, endMode: r.end_mode, endTime: r.end_time }),
        validateDailySpecialContent({ shortSummary: r.short_summary, description: r.description })]) if (!res.valid) p.push(...res.errors);
      if (!["food", "drink", "food_drink"].includes(r.offer_type)) p.push(`bad offer_type ${r.offer_type}`);
      if (!r.source_url || !r.last_verified_at) p.push("missing source_url/last_verified_at");
      if (!/\$|%|½|half|off|free|bogo|waived|no corkage/i.test(`${r.title} ${r.short_summary} ${r.description ?? ""}`)) w.push("no price/discount wording");
      if (dupId(r.id)) p.push("duplicate id in batch"); if ((idHits ?? []).some((x: any) => x.id === r.id)) p.push("id already exists");
      const k = `${r.venue_id}|${r.title.toLowerCase()}`; if (seenKey.has(k)) p.push("duplicate venue/title in batch"); seenKey.add(k);
      const dupe = (existing ?? []).find((x: any) => x.venue_id === r.venue_id && x.title.toLowerCase() === r.title.toLowerCase()); if (dupe) p.push(`existing special with same title at venue (${dupe.id})`);
      for (const d of r.days_of_week) { const h = v?.business_hours?.[WEEKDAYS[d]];
        if (v && !h) p.push(`${WEEKDAY_TITLES[d]}: venue closed`);
        else if (h && r.start_time) { const s = r.start_time.slice(0, 5); const cl = h.close <= h.open ? "24:00" : h.close; if (!(s >= h.open && s < cl)) w.push(`${WEEKDAY_TITLES[d]}: starts ${s} outside hours ${h.open}–${h.close}`); }
        if (h && r.end_mode === "time" && r.end_time && endsAfterClose(r.start_time?.slice(0, 5) ?? null, r.end_time.slice(0, 5), h)) p.push(`${WEEKDAY_TITLES[d]}: ends ${r.end_time} after venue close ${h.close}`); }
      if (r.end_mode === "time" && r.start_time && r.end_time && r.end_time <= r.start_time) w.push(`ends after midnight (${r.start_time}–${r.end_time}) — displays as a plain range; day filters use the start day`);
      if (v?.hh_times && /happy hour/i.test(`${r.title} ${r.short_summary}`)) w.push("mentions happy hour — confirm not duplicating hh_times");
      perRow.push({ id: r.id, venue: r.venue_slug, title: r.title, decision: r.decision, errors: p, warnings: w });
      if (p.length) errors.push(`${r.venue_slug} / ${r.title}: ${p.join("; ")}`); if (w.length) warnings.push(`${r.venue_slug} / ${r.title}: ${w.join("; ")}`);
    }
  }
  const ok = batch.rows.filter((r: any) => !perRow.find((x) => x.id === r.id)!.errors.length);
  const byCity: Record<string, number> = {}; for (const r of ok) byCity[r.city] = (byCity[r.city] ?? 0) + 1;
  writeSql(batch, dir, ok, approver!);
  const report = { kind: batch.kind, market: batch.market, asOf: batch.asOf, ranAt: new Date().toISOString(), mode: "dry-run", total: batch.rows.length, insertable: ok.length,
    blocked: batch.rows.length - ok.length, venues: new Set(ok.map((r: any) => r.venue_id)).size, byCity, errors, warnings, rows: perRow };
  const rf = path.join(dir, `dry-run.${new Date().toISOString().replace(/[:.]/g, "-")}.json`); fs.writeFileSync(rf, JSON.stringify(report, null, 1));
  const series = batch.kind === "events" ? ` · series ${new Set(ok.map((r: any) => `${r.venue_slug}|${r.title}`)).size}` : "";
  console.log(`Summary: ${batch.kind} insert ${ok.length} · blocked ${batch.rows.length - ok.length} · venues ${report.venues}${series}`);
  console.log(`By city: ${Object.entries(byCity).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ")}`);
  for (const e of errors) console.log(`  BLOCKED ${e}`); for (const w of warnings) console.log(`  warn    ${w}`);
  console.log(`Report: ${rf}\nSQL written (not run): ${dir}/apply.sql · publish.sql · rollback.sql — ${ok.length} rows`);
}

// ─────────────────────────────── offline SQL / manifest ───────────────────────────────
function sql() { const { batch, dir } = readBatch(); const approver = arg("approver") ?? fail("--approver=<email>");
  const rows = batch.kind === "events" ? batch.rows.filter((r: any) => r.image.status === "ok") : batch.rows;
  writeSql(batch, dir, rows, approver!); console.log(`SQL written (offline, no checks against the database): ${dir}/apply.sql · publish.sql · rollback.sql — ${rows.length} rows`); }
function imageManifest() {
  const { batch, dir } = readBatch(); if (batch.kind !== "events") fail("image-manifest is for event batches");
  const src = new Map(readCsv(fs.readFileSync(arg("sources") ?? fail("--sources=<stock photo sources csv>"), "utf8")).map((r) => [r.slot_id, r]));
  const cols = ["slot_id", "decision", "prepared_file", "prepared_sha256", "unsplash_id", "photographer", "licence", "event_id", "city", "venue", "event_title", "schedule", "storage_path (venue-images bucket)", "image_url"];
  const L = [cols.join(",")]; const missing: string[] = [];
  for (const r of [...batch.rows].sort((a: any, b: any) => (a.image.slot + a.venue_name).localeCompare(b.image.slot + b.venue_name) || a.weekday - b.weekday)) {
    const s = src.get(r.image.slot); if (!s) missing.push(r.image.slot);
    if (s && s.prepared_sha256 && s.prepared_sha256 !== r.image.sha256) fail(`${r.image.slot}: sources CSV prepared_sha256 differs from the batch`);
    L.push([r.image.slot, s?.decision, imageFile(r.image), r.image.sha256, s?.unsplash_id, s?.photographer, s?.licence, r.id, r.city, r.venue_name, r.title, `${r.event_frequency} ${r.event_time}`, r.image.storage_path, r.image.url].map(csvCell).join(","));
  }
  if (missing.length) fail(`slots missing from sources CSV: ${[...new Set(missing)].join(", ")}`);
  fs.writeFileSync(path.join(dir, "image-manifest.csv"), L.join("\n") + "\n"); console.log(`image-manifest.csv: ${batch.rows.length} rows, ${new Set(batch.rows.map((r: any) => r.image.slot)).size} images`);
}

/**
 * replay --dir=<batch dir> --approver=<email> — offline release-record check. Rebuilds the batch from the committed input
 * CSV with --reuse=<dir>/batch.json (same IDs, slugs, Storage paths, first dates), then regenerates the SQL and compares
 * both with the committed files. Statements must match; only comments, quote-tag numbering and the audit 'via' label may differ.
 */
async function replay() {
  const dir = arg("dir") ?? fail("--dir=<batch dir>"); const approver = arg("approver") ?? fail("--approver=<email used for the release>");
  const committed = JSON.parse(fs.readFileSync(path.join(dir!, "batch.json"), "utf8"));
  const input = path.join(dir!, committed.kind === "events" ? "input-events.csv" : "input-specials.csv");
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "content-replay-"));
  const { execFileSync } = require("child_process");
  execFileSync(process.execPath, [...process.execArgv, __filename, "build", `--kind=${committed.kind}`, `--input=${input}`, `--market=${committed.market}`, `--as-of=${committed.asOf}`,
    `--reuse=${path.join(dir!, "batch.json")}`, "--offline", `--out=${tmp}`], { stdio: "pipe" });
  const rebuilt = JSON.parse(fs.readFileSync(path.join(tmp, "batch.json"), "utf8"));
  const A = new Map<string, any>(committed.rows.map((r: any) => [r.key, r])), B = new Map<string, any>(rebuilt.rows.map((r: any) => [r.key, r]));
  const problems: string[] = [];
  for (const k of new Set([...A.keys(), ...B.keys()])) { const a = A.get(k), b = B.get(k); if (!a || !b) { problems.push(`${k}: ${a ? "missing from rebuild" : "extra in rebuild"}`); continue; }
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) problems.push(`${k}: ${f} differs`); }
  const rows = committed.kind === "events" ? rebuilt.rows.filter((r: any) => r.image.status === "ok") : rebuilt.rows;
  writeSql(rebuilt, tmp, rows, approver!);
  const norm = (s: string) => s.replace(/\$q\d+\$/g, "$q$").replace(/'via', [^)]*\)\);/g, "'via', <via>));").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() && !l.trimStart().startsWith("--"));
  for (const f of ["apply.sql", "publish.sql", "rollback.sql"]) {
    if (!fs.existsSync(path.join(dir!, f))) { problems.push(`${f} not committed`); continue; }
    const a = norm(fs.readFileSync(path.join(dir!, f), "utf8")), b = norm(fs.readFileSync(path.join(tmp, f), "utf8"));
    if (a.length !== b.length || a.some((l, i) => l !== b[i])) problems.push(`${f}: statements differ from the regenerated SQL`);
  }
  console.log(problems.length ? `REPLAY ${committed.kind}: ${problems.length} PROBLEM(S)\n  ${problems.slice(0, 20).join("\n  ")}`
    : `REPLAY ${committed.kind}: OK — ${rebuilt.rows.length} rows rebuilt identically from ${path.basename(input)}; apply/publish/rollback statements match`);
  if (problems.length) process.exit(1);
}

// ─────────────────────────────── Storage ───────────────────────────────
async function uploadImages() {
  const { batch } = readBatch(); if (batch.kind !== "events") fail("upload-images is for event batches");
  const dir = arg("images-dir") ?? fail("--images-dir=<prepared images dir>"); const apply = flag("apply");
  for (const r of batch.rows) {
    if (r.image.status !== "ok") { console.log(`SKIP ${r.slug}: image ${r.image.slot} ${r.image.status}`); continue; }
    const bytes = fs.readFileSync(path.join(dir!, imageFile(r.image))); if (sha(bytes) !== r.image.sha256) fail(`${r.image.slot}: local file differs from the reviewed batch`);
    if (!apply) { console.log(`would upload ${imageFile(r.image)} → ${BUCKET}/${r.image.storage_path}`); continue; }
    const { error } = await db().storage.from(BUCKET).upload(r.image.storage_path, bytes, { cacheControl: "31536000", upsert: false, contentType: "image/jpeg" });
    console.log(`${error ? "ERROR " + error.message : "uploaded"} ${r.image.storage_path}`);
  }
  if (!apply) console.log("(dry run — nothing uploaded; add --apply only after approval)");
}
async function storageObjects() {
  const { batch } = readBatch(); const paths = storageObjectsFor(batch); paths.forEach((p) => console.log(`${BUCKET}/${p}`));
  if (!flag("remove")) return console.log(`${paths.length} objects (list only)`);
  const { data } = await db().from("events").select("id").in("id", batch.rows.map((r: any) => r.id));
  const live = new Set((data ?? []).map((x: any) => x.id)); const removable = batch.rows.filter((r: any) => !live.has(r.id)).map((r: any) => r.image.storage_path);
  console.log(`${removable.length} of ${paths.length} objects belong to events that no longer exist${live.size ? ` (${live.size} event rows still exist — their objects are kept)` : ""}`);
  if (!flag("apply")) return console.log("(dry run — add --apply to delete exactly those objects, only after approval)");
  const { error } = await db().storage.from(BUCKET).remove(removable); console.log(error ? `ERROR ${error.message}` : `removed ${removable.length}`);
}

// ─────────────────────────────── verify ───────────────────────────────
async function verify() {
  const { batch } = readBatch(); const stage = arg("stage"); if (!["images", "draft", "published"].includes(stage ?? "")) fail("--stage=images|draft|published");
  const only = arg("ids") ? new Set(fs.readFileSync(arg("ids")!, "utf8").split(/\s+/).filter(Boolean)) : null;
  const rows = batch.rows.filter((r: any) => (!only || only.has(r.id)) && (batch.kind !== "events" || r.image.status === "ok"));
  const fails: string[] = [];
  if (stage === "images") {
    if (batch.kind !== "events") fail("images stage is for event batches");
    for (const r of rows) { const res = await fetch(r.image.url); const b = Buffer.from(await res.arrayBuffer());
      if (res.status !== 200 || !/image\/jpeg/.test(res.headers.get("content-type") ?? "") || sha(b) !== r.image.sha256) fails.push(`${r.slug}: ${res.status} ${res.headers.get("content-type")} sha ${sha(b) === r.image.sha256 ? "ok" : "MISMATCH"}`); }
  } else {
    const table = batch.kind === "events" ? "events" : "daily_specials";
    const { data } = await db().from(table).select("*").in("id", rows.map((r: any) => r.id)); const got = new Map((data ?? []).map((x: any) => [x.id, x]));
    const F = batch.kind === "events" ? ["venue_id", "title", "slug", "first_date", "start_time", "end_time", "event_time", "event_frequency", "recurrence", "event_type", "description", "teaser", "price_display", "age_restriction", "is_seeded_event"]
      : ["venue_id", "title", "offer_type", "short_summary", "description", "conditions", "schedule_type", "days_of_week", "time_mode", "end_mode", "source_url", "is_seeded_special"];
    for (const r of rows) { const d = got.get(r.id); if (!d) { fails.push(`${r.id} ${r.title}: missing`); continue; }
      for (const f of F) if (JSON.stringify(d[f]) !== JSON.stringify(r[f])) fails.push(`${r.title}: ${f} ${JSON.stringify(d[f])} ≠ ${JSON.stringify(r[f])}`);
      if (batch.kind === "events" && d.image_url !== r.image.url) fails.push(`${r.title}: image_url`);
      if (batch.kind === "specials") for (const f of ["start_time", "end_time"]) if ((d[f] ?? null)?.slice(0, 5) !== (r[f] ?? null)?.slice(0, 5)) fails.push(`${r.title}: ${f}`);
      if (d.is_published !== (stage === "published")) fails.push(`${r.title}: is_published=${d.is_published}`);
      if (d.created_by_operator_id || d.updated_by_operator_id) fails.push(`${r.title}: operator attribution set`); }
  }
  console.log(fails.length ? `${stage!.toUpperCase()} VERIFY: ${fails.length} FAIL\n  ${fails.join("\n  ")}` : `${stage!.toUpperCase()} VERIFY: ALL PASS (${rows.length} rows)`);
  if (fails.length) process.exit(1);
}

const cmds: Record<string, () => unknown> = { build, "dry-run": dryRun, sql, replay, "image-manifest": imageManifest, "upload-images": uploadImages, verify, "storage-objects": storageObjects };
const cmd = process.argv[2]; if (!cmds[cmd!]) fail(`command: ${Object.keys(cmds).join(" | ")}`);
Promise.resolve(cmds[cmd!]()).catch((e) => fail(String(e?.message ?? e)));
