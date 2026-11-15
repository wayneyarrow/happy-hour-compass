/**
 * Daily Specials + recurring Events seed batches — pure helpers (no I/O, no database).
 * Used by scripts/seeding/contentSeedBatch.ts. Playbook: docs/operations/MARKET_CONTENT_SEEDING_PLAYBOOK.md.
 *
 * Row shapes mirror the Central Okanagan seeded rows (public.events / public.daily_specials) with the venue-seeding gates
 * added: drafts (is_published=false) → exact-ID publish with a row-count guard and an audit row → guarded rollback.
 */

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export const WEEKDAY_TITLES = WEEKDAYS.map((d) => d[0].toUpperCase() + d.slice(1));
const DAY_ALIASES: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
WEEKDAYS.forEach((d, i) => { DAY_ALIASES[d] = i; DAY_ALIASES[String(i)] = i; });

/** "fri;sat" | "5;6" | "Friday" → [5, 6]. Throws on anything else. */
export function parseDays(s: string): number[] {
  const out = String(s ?? "").split(/[;|,\s]+/).filter(Boolean).map((t) => {
    const d = DAY_ALIASES[t.toLowerCase()]; if (d === undefined) throw new Error(`unknown weekday "${t}"`); return d; });
  if (!out.length) throw new Error("no weekdays");
  if (new Set(out).size !== out.length) throw new Error(`duplicate weekday in "${s}"`);
  return out;
}

export const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const weekdayOf = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();
/** First occurrence of `weekday` on or after `asOf` (YYYY-MM-DD, already in the market's local date). */
export const firstDateOnOrAfter = (asOf: string, weekday: number) => addDays(asOf, (weekday - weekdayOf(asOf) + 7) % 7);
/** Today's date in a given IANA zone (e.g. America/Los_Angeles) — the as-of default is decided in market-local time. */
export const localToday = (timeZone: string, now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);

/** "7:30 PM" → "19:30"; anything else → null. Event times are stored as text in this shape (CO convention). */
export function to24(t: string | null | undefined): string | null {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i); if (!m) return null;
  let h = +m[1] % 12; if (m[3].toUpperCase() === "PM") h += 12; return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Same rule as src/lib/eventSlug.ts buildBaseEventSlug + src/lib/slugify.ts. */
export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** One series on several weekdays → one row per weekday; their slugs get a "-<weekday>s" suffix so each is unique. */
export function eventSlug(venueSlug: string, title: string, weekday: number, multiDaySeries: boolean): string {
  const base = `${venueSlug.toLowerCase()}-${slugify(title) || "event"}`;
  return multiDaySeries ? `${base}-${WEEKDAYS[weekday]}s` : base;
}

export type EventSeriesInput = { venue_slug: string; title: string; event_type: string; days: number[]; start_time: string; end_time: string | null;
  description: string | null; teaser: string | null; price_display: string | null; age_restriction: string | null; image_slot: string;
  source_url: string; evidence: string | null; note: string | null; verified_on: string };

/**
 * Expand series into one event row per weekday — the only recurring shape the app supports. A series whose time differs by
 * day is given as several input rows with the same venue + title (one per time window); the weekday slug suffix applies
 * whenever a venue + title spans more than one weekday across ALL input rows. A weekday may appear only once per venue + title.
 */
export function expandSeries(series: EventSeriesInput[], asOf: string) {
  const span = new Map<string, number[]>();
  for (const s of series) { const k = `${s.venue_slug}|${s.title}`; const d = span.get(k) ?? []; d.push(...s.days); span.set(k, d); }
  for (const [k, d] of span) if (new Set(d).size !== d.length) throw new Error(`${k}: a weekday is listed twice`);
  return series.flatMap((s) => s.days.map((weekday) => ({
    key: `${s.venue_slug}|${s.title}|${weekday}`, venue_slug: s.venue_slug, title: s.title, weekday,
    slug: eventSlug(s.venue_slug, s.title, weekday, span.get(`${s.venue_slug}|${s.title}`)!.length > 1), first_date: firstDateOnOrAfter(asOf, weekday),
    start_time: s.start_time, end_time: s.end_time, event_time: s.end_time ? `${s.start_time} – ${s.end_time}` : s.start_time,
    event_frequency: `Every ${WEEKDAY_TITLES[weekday]}`, recurrence: "weekly" as const, event_type: s.event_type, description: s.description,
    teaser: s.teaser, price_display: s.price_display, age_restriction: s.age_restriction, image_slot: s.image_slot,
    source_url: s.source_url, evidence: s.evidence, note: s.note, verified_on: s.verified_on })));
}

/** Minutes-based "does the window end after the venue closes" check (handles overnight closes and ends). */
export function endsAfterClose(start: string | null, end: string, hours: { open: string; close: string } | null | undefined): boolean {
  if (!hours) return false;
  const m = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const st = start ? m(start) : m(hours.open); let en = m(end); if (en <= st) en += 1440;
  let cl = m(hours.close); if (cl <= m(hours.open)) cl += 1440; return en > cl;
}

/** Image spacing rules for event photos: one image never repeats at one venue, nor on the same weekday. */
export function imageSpacingProblems(rows: { venue_slug: string; title: string; weekday: number; image_slot: string }[]): string[] {
  const p: string[] = []; const day = new Map<string, Set<string>>(), venue = new Map<string, Set<string>>();
  for (const r of rows) {
    const series = `${r.venue_slug}|${r.title}`;
    const dk = `${r.image_slot}|${r.weekday}`; const ds = day.get(dk) ?? new Set(); ds.add(series); day.set(dk, ds);
    const vk = `${r.image_slot}|${r.venue_slug}`; const vs = venue.get(vk) ?? new Set(); vs.add(r.title); venue.set(vk, vs);
  }
  for (const [k, s] of day) if (s.size > 1) p.push(`${k.split("|")[0]} used by ${s.size} series on ${WEEKDAY_TITLES[+k.split("|")[1]]}: ${[...s].join(", ")}`);
  for (const [k, s] of venue) if (s.size > 1) p.push(`${k.split("|")[0]} used ${s.size} times at ${k.split("|")[1]}: ${[...s].join(", ")}`);
  return p;
}

// ─────────────────────────────── SQL ───────────────────────────────
export type SqlBatch = { kind: "events" | "specials"; market: string; rows: any[] };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MARKET_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function quoter() { let n = 0; return (s: unknown) => { if (s == null) return "NULL"; const t = `$q${++n}$`; const str = String(s); if (str.includes("$q")) throw new Error("value contains a reserved quote tag"); return `${t}${str}${t}`; }; }
function checkRows(batch: SqlBatch) {
  if (!MARKET_RE.test(batch.market)) throw new Error(`bad market slug ${batch.market}`);
  if (!batch.rows.length) throw new Error("no rows");
  const ids = new Set<string>();
  for (const r of batch.rows) {
    if (!UUID_RE.test(r.id) || !UUID_RE.test(r.venue_id)) throw new Error(`bad id/venue_id on ${r.title}`);
    if (ids.has(r.id)) throw new Error(`duplicate id ${r.id}`); ids.add(r.id);
    if (batch.kind === "events" && (!/^\d{4}-\d{2}-\d{2}$/.test(r.first_date) || !Number.isInteger(r.weekday))) throw new Error(`bad first_date/weekday on ${r.slug}`);
    if (batch.kind === "specials") {
      for (const t of [r.start_time, r.end_time]) if (t != null && !TIME_RE.test(t)) throw new Error(`bad time ${t} on ${r.title}`);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.last_verified_at ?? "")) throw new Error(`bad last_verified_at on ${r.title}`);
      if (!Array.isArray(r.days_of_week) || r.days_of_week.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) throw new Error(`bad days_of_week on ${r.title}`);
    }
  }
}
const eligible = (market: string, vid: string) => `EXISTS (SELECT 1 FROM public.venues v JOIN public.markets m ON m.id = v.market_id WHERE v.id = '${vid}' AND m.slug = '${market}' AND v.is_published AND v.source = 'seed' AND v.claimed_at IS NULL AND v.claimed_by IS NULL AND v.created_by_operator_id IS NULL AND v.cancelled_at IS NULL)`;

/** Draft import: one transaction; every row guarded (venue still an unclaimed published seed in the market, no duplicate); any miss raises → nothing applied. */
export function buildApplySql(batch: SqlBatch, note = ""): string {
  checkRows(batch); const q = quoter(); const ev = batch.kind === "events"; const table = ev ? "events" : "daily_specials";
  const L = [`-- ${batch.kind} DRAFT import (is_published = false) for ${batch.market}${note ? " — " + note : ""}`,
    `-- ${batch.rows.length} rows, one transaction: any guard failure raises and nothing is applied. Run only after approval.`, "BEGIN;", "DO $do$", "DECLARE c int;", "BEGIN"];
  for (const r of batch.rows) {
    if (ev) L.push(`  INSERT INTO public.events (id, venue_id, title, slug, first_date, start_time, end_time, event_time, event_frequency, recurrence, event_type, description, teaser, price_display, age_restriction, image_url, is_published, is_seeded_event, is_genuine_operator_engaged)
  SELECT '${r.id}', '${r.venue_id}', ${q(r.title)}, ${q(r.slug)}, '${r.first_date}'::date, ${q(r.start_time)}, ${q(r.end_time)}, ${q(r.event_time)}, ${q(r.event_frequency)}, 'weekly', ${q(r.event_type)}, ${q(r.description)}, ${q(r.teaser)}, ${q(r.price_display)}, ${q(r.age_restriction)}, ${q(r.image?.url)}, false, true, false
  WHERE ${eligible(batch.market, r.venue_id)}
    AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.venue_id = '${r.venue_id}' AND lower(e.title) = lower(${q(r.title)}) AND e.recurrence = 'weekly' AND extract(dow FROM e.first_date) = ${r.weekday})
    AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.slug = ${q(r.slug)}) AND NOT EXISTS (SELECT 1 FROM public.event_slug_history h WHERE h.old_slug = ${q(r.slug)});`);
    else L.push(`  INSERT INTO public.daily_specials (id, venue_id, title, offer_type, short_summary, description, conditions, schedule_type, days_of_week, time_mode, start_time, end_mode, end_time, is_published, is_seeded_special, is_genuine_operator_engaged, source_url, last_verified_at)
  SELECT '${r.id}', '${r.venue_id}', ${q(r.title)}, ${q(r.offer_type)}, ${q(r.short_summary)}, ${q(r.description)}, ${q(r.conditions)}, 'weekly', ARRAY[${r.days_of_week.map((d: number) => Number(d)).join(",")}]::smallint[], ${q(r.time_mode)}, ${r.start_time ? `'${r.start_time}'::time` : "NULL"}, ${q(r.end_mode)}, ${r.end_time ? `'${r.end_time}'::time` : "NULL"}, false, true, false, ${q(r.source_url)}, '${r.last_verified_at}'::timestamptz
  WHERE ${eligible(batch.market, r.venue_id)}
    AND NOT EXISTS (SELECT 1 FROM public.daily_specials s WHERE s.venue_id = '${r.venue_id}' AND lower(s.title) = lower(${q(r.title)}));`);
    L.push(`  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for %', ${q(ev ? r.slug : `${r.venue_slug} / ${r.title}`)}; END IF;`);
  }
  L.push("END", "$do$;", `SELECT count(*) AS drafts_inserted FROM public.${table} WHERE id IN (${batch.rows.map((r) => `'${r.id}'`).join(", ")}) AND NOT is_published;`, "COMMIT;");
  return L.join("\n") + "\n";
}

/** Exact-ID publish: only unpublished seeded rows nobody has edited, venue still an unclaimed published seed; exactly N or nothing; one audit row. */
export function buildPublishSql(batch: SqlBatch, approverEmail: string): string {
  checkRows(batch); if (!/^[^\s'@]+@[^\s'@]+\.[^\s'@]+$/.test(approverEmail)) throw new Error("approver email required");
  const q = quoter(); const ev = batch.kind === "events"; const table = ev ? "events" : "daily_specials"; const flag = ev ? "is_seeded_event" : "is_seeded_special";
  const N = batch.rows.length; const ids = batch.rows.map((r) => `'${r.id}'`).join(", ");
  return [`-- ${batch.kind} exact-ID PUBLISH for ${batch.market} (${N} rows). Run only after the drafts are verified and publication is approved.`, "BEGIN;", "DO $do$", "DECLARE n int;", "BEGIN",
    `  UPDATE public.${table} t SET is_published = true
   WHERE t.id IN (${ids})
     AND t.is_published = false AND t.${flag} AND t.created_by_operator_id IS NULL AND t.updated_by_operator_id IS NULL
     AND EXISTS (SELECT 1 FROM public.venues v JOIN public.markets m ON m.id = v.market_id WHERE v.id = t.venue_id AND m.slug = '${batch.market}' AND v.is_published AND v.source = 'seed' AND v.claimed_at IS NULL AND v.created_by_operator_id IS NULL AND v.cancelled_at IS NULL);`,
    "  GET DIAGNOSTICS n = ROW_COUNT;", `  IF n <> ${N} THEN RAISE EXCEPTION 'expected exactly ${N} rows published, got % — nothing applied', n; END IF;`,
    `  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, entity_name, details_json)
  VALUES (${q(approverEmail)}, '${ev ? "event_bulk_published" : "daily_special_bulk_published"}', '${ev ? "event_batch" : "daily_special_batch"}', NULL, ${q(batch.market)},
          jsonb_build_object('count', ${N}, 'market', ${q(batch.market)}, 'ids', jsonb_build_array(${ids}), 'via', 'scripts/seeding/contentSeedBatch.ts publish.sql'));`,
    "END", "$do$;", `SELECT count(*) FILTER (WHERE is_published) AS published_now, count(*) AS targeted FROM public.${table} WHERE id IN (${ids});`, "COMMIT;"].join("\n") + "\n";
}

/** Rollback: deletes only these seeded rows that no operator has touched. Event images in Storage are NOT removed (see storageObjectsFor). */
export function buildRollbackSql(batch: SqlBatch): string {
  checkRows(batch); const ev = batch.kind === "events"; const table = ev ? "events" : "daily_specials"; const flag = ev ? "is_seeded_event" : "is_seeded_special";
  const lines = [`-- ROLLBACK for the ${batch.kind} batch in ${batch.market} (${batch.rows.length} rows). Deletes only seeded, never-operator-touched rows.`];
  if (ev) lines.push("-- Storage objects are not deleted by SQL — list them with: contentSeedBatch.ts storage-objects --batch=<batch.json>");
  lines.push("BEGIN;", `DELETE FROM public.${table} WHERE id IN (${batch.rows.map((r) => `'${r.id}'`).join(", ")}) AND ${flag} AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL;`, "COMMIT;");
  return lines.join("\n") + "\n";
}

/** Storage paths (bucket venue-images) owned by an event batch — one per event row, under events/<eventId>/. */
export function storageObjectsFor(batch: SqlBatch): string[] {
  if (batch.kind !== "events") return [];
  return batch.rows.map((r) => { const p = r.image?.storage_path; if (!p || !p.startsWith(`events/${r.id}/`)) throw new Error(`row ${r.id} has no storage path under events/<id>/`); return p; });
}

// ─────────────────────────────── CSV ───────────────────────────────
/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, embedded newlines). */
export function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let r: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { r.push(f); f = ""; } else if (c === "\n") { r.push(f); rows.push(r); r = []; f = ""; } else if (c !== "\r") f += c; }
  if (f || r.length) { r.push(f); rows.push(r); }
  const [h, ...d] = rows; return d.filter((x) => x.some((v) => v !== "")).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i] ?? ""])));
}
export const csvCell = (x: unknown) => { const s = x == null ? "" : Array.isArray(x) ? x.join(";") : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export const EVENT_INPUT_COLUMNS = ["venue_slug", "title", "event_type", "days", "start_time", "end_time", "description", "teaser", "price_display", "age_restriction", "image_slot", "source_url", "evidence", "note", "verified_on"] as const;
export const SPECIAL_INPUT_COLUMNS = ["venue_slug", "title", "offer_type", "days", "time_mode", "start_time", "end_mode", "end_time", "short_summary", "description", "conditions", "source_url", "evidence", "decision", "note", "verified_on"] as const;
const nul = (s: string | undefined) => (s == null || s === "" ? null : s);
function requireColumns(rows: Record<string, string>[], cols: readonly string[], kind: string) {
  if (!rows.length) throw new Error(`${kind} input has no rows`);
  const missing = cols.filter((c) => !(c in rows[0])); if (missing.length) throw new Error(`${kind} input missing columns: ${missing.join(", ")}`);
  const extra = Object.keys(rows[0]).filter((c) => !cols.includes(c)); if (extra.length) throw new Error(`${kind} input has unknown columns: ${extra.join(", ")}`);
}
export function parseEventInput(text: string): EventSeriesInput[] {
  const rows = readCsv(text); requireColumns(rows, EVENT_INPUT_COLUMNS, "events");
  return rows.map((r) => ({ venue_slug: r.venue_slug, title: r.title, event_type: r.event_type, days: parseDays(r.days), start_time: r.start_time, end_time: nul(r.end_time),
    description: nul(r.description), teaser: nul(r.teaser), price_display: nul(r.price_display), age_restriction: nul(r.age_restriction), image_slot: r.image_slot,
    source_url: r.source_url, evidence: nul(r.evidence), note: nul(r.note), verified_on: r.verified_on }));
}
export function parseSpecialInput(text: string) {
  const rows = readCsv(text); requireColumns(rows, SPECIAL_INPUT_COLUMNS, "specials");
  return rows.map((r) => ({ venue_slug: r.venue_slug, title: r.title, offer_type: r.offer_type, days_of_week: parseDays(r.days), time_mode: r.time_mode,
    start_time: nul(r.start_time), end_mode: r.end_mode, end_time: nul(r.end_time), short_summary: r.short_summary, description: nul(r.description),
    conditions: nul(r.conditions), source_url: r.source_url, evidence: nul(r.evidence), decision: nul(r.decision), note: nul(r.note), verified_on: r.verified_on }));
}
