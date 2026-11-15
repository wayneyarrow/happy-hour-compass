/**
 * Guarded seed-publish SQL — pure builder (no I/O, no database).
 *
 * Publishing a seed batch is the only step that makes imported drafts public, so it is scoped as tightly as the
 * Greater San Diego rollout did it (playbook: docs/operations/MARKET_SEEDING_PLAYBOOK.md, Step 5):
 *   • exact venue IDs taken from the importer's apply report, each pinned to its expected city, inside one market;
 *   • only is_published is set, and only on unpublished, unowned, unverified, uncancelled `seed` rows with a photo and
 *     happy hour times (mirrors qaPublishImportedVenuesAction);
 *   • a row-count guard raises — rolling back everything — unless exactly N rows were published;
 *   • one venue_bulk_published audit_logs row lists the IDs.
 * The SQL is written to a file for review and run separately (`supabase db query --linked -f <file>`), only after
 * Wayne approves publication. Building it never touches the database.
 */

export type PublishTarget = { id: string; slug: string; citySlug: string };

export type CsvTargetRow = { slug: string; city_slug: string; market_slug: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}$/;
const EMAIL_RE = /^[^\s'@]+@[^\s'@]+\.[^\s'@]+$/;

/**
 * Pairs the inserted IDs from an importer apply report with the reviewed CSV rows. The two must describe exactly the
 * same venues (no extra, missing or duplicate rows), all in `marketSlug`; anything else is returned as an error.
 */
export function planPublishTargets(
  applyReport: unknown,
  csvRows: CsvTargetRow[],
  marketSlug: string
): { targets: PublishTarget[]; errors: string[] } {
  const errors: string[] = [];
  const report = applyReport as { mode?: string; market?: string; results?: { slug?: string; outcome?: string; id?: string }[] };
  if (!report || report.mode !== "apply") errors.push(`apply report mode must be "apply" (got ${JSON.stringify(report?.mode)})`);
  if (report?.market && report.market !== marketSlug) errors.push(`apply report is for market ${report.market}, not ${marketSlug}`);
  const inserted = (report?.results ?? []).filter((r) => r.outcome === "inserted");
  if (!inserted.length) errors.push("apply report has no inserted rows");

  const bySlug = new Map(csvRows.map((r) => [r.slug, r]));
  if (bySlug.size !== csvRows.length) errors.push("CSV has duplicate slugs");
  const seenIds = new Set<string>();
  const targets: PublishTarget[] = [];
  for (const r of inserted) {
    const slug = r.slug ?? "", id = r.id ?? "";
    if (!UUID_RE.test(id)) { errors.push(`inserted row ${slug || "?"} has an invalid id ${JSON.stringify(id)}`); continue; }
    if (seenIds.has(id)) { errors.push(`id ${id} appears twice in the apply report`); continue; }
    seenIds.add(id);
    const row = bySlug.get(slug);
    if (!row) { errors.push(`inserted slug ${slug} is not in the reviewed CSV`); continue; }
    if (row.market_slug !== marketSlug) { errors.push(`${slug}: CSV market_slug ${row.market_slug} is not ${marketSlug}`); continue; }
    if (!SLUG_RE.test(row.city_slug ?? "")) { errors.push(`${slug}: invalid city_slug ${JSON.stringify(row.city_slug)}`); continue; }
    targets.push({ id, slug, citySlug: row.city_slug });
  }
  const insertedSlugs = new Set(inserted.map((r) => r.slug));
  for (const r of csvRows) if (!insertedSlugs.has(r.slug)) errors.push(`CSV row ${r.slug} has no inserted id in the apply report`);
  return { targets: errors.length ? [] : targets, errors };
}

export type GuardedPublishOptions = {
  marketSlug: string;
  /** Human-readable market name for the audit row (e.g. "Greater San Diego"). */
  marketName: string;
  /** Short batch label recorded in the audit row (e.g. "gsd-batch4"). */
  batchLabel: string;
  /** The person who approved publication — recorded as the audit actor. */
  approverEmail: string;
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Builds the reviewed one-transaction publish SQL. Throws on any unsafe or malformed input. */
export function buildGuardedPublishSql(targets: PublishTarget[], o: GuardedPublishOptions): string {
  if (!targets.length) throw new Error("no publish targets");
  if (!SLUG_RE.test(o.marketSlug)) throw new Error(`invalid market slug ${o.marketSlug}`);
  if (!LABEL_RE.test(o.batchLabel)) throw new Error(`invalid batch label ${o.batchLabel}`);
  if (!EMAIL_RE.test(o.approverEmail)) throw new Error("invalid approver email");
  if (!o.marketName.trim()) throw new Error("market name required");
  const ids = new Set<string>();
  for (const t of targets) {
    if (!UUID_RE.test(t.id)) throw new Error(`invalid venue id ${t.id}`);
    if (!SLUG_RE.test(t.citySlug)) throw new Error(`invalid city slug ${t.citySlug} for ${t.id}`);
    if (ids.has(t.id)) throw new Error(`duplicate venue id ${t.id}`);
    ids.add(t.id);
  }
  const n = targets.length;
  const values = targets.map((t) => `('${t.id}'::uuid, '${t.citySlug}')`).join(",\n      ");
  const idList = targets.map((t) => `'${t.id}'`).join(", ");
  return `-- Guarded publish: ${n} reviewed ${o.marketName} seed venues (batch ${o.batchLabel}).
-- Generated by operator-admin/scripts/seeding/buildGuardedPublishSql.ts. Sets ONLY is_published = true on unowned,
-- unpublished, unverified seed rows, scoped by exact id + each row's expected city in market ${o.marketSlug}, and writes
-- one venue_bulk_published audit event. Aborts (nothing changed) unless exactly ${n} rows are published.
-- Run only after Wayne approves publication:  supabase db query --linked -f <this file>
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  WITH targets(id, city_slug) AS (VALUES
      ${values})
  UPDATE public.venues v
     SET is_published = true
    FROM targets t, public.markets m, public.cities c
   WHERE v.id = t.id
     AND v.is_published = false
     AND v.created_by_operator_id IS NULL AND v.updated_by_operator_id IS NULL
     AND v.claimed_at IS NULL AND v.claimed_by IS NULL
     AND v.is_verified = false
     AND v.cancelled_at IS NULL
     AND v.source = 'seed'
     AND m.id = v.market_id AND m.slug = '${o.marketSlug}'
     AND c.id = v.city_id AND c.slug = t.city_slug
     AND v.placeholder_image_path IS NOT NULL
     AND v.hh_times IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> ${n} THEN RAISE EXCEPTION 'expected exactly ${n} venues published, got % — nothing applied', n; END IF;

  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, entity_name, details_json)
  VALUES (${q(o.approverEmail)}, 'venue_bulk_published', 'venue_batch', NULL, ${q(o.marketName)},
          jsonb_build_object('count', ${n}, 'market', '${o.marketSlug}', 'batch', ${q(o.batchLabel)},
            'venue_ids', jsonb_build_array(${idList}),
            'via', 'Claude Code, approved by Wayne; mirrors qaPublishImportedVenuesAction'));
END $$;
SELECT count(*) FILTER (WHERE is_published) AS published_now, count(*) AS targeted
  FROM public.venues WHERE id IN (${idList});
COMMIT;
`;
}
