/**
 * scripts/seeding/buildGuardedPublishSql.ts
 *
 * Writes the guarded publish SQL for one imported seed batch. Never connects to a database.
 *
 * Usage (from operator-admin/):
 *   npx tsx scripts/seeding/buildGuardedPublishSql.ts \
 *     --csv=../docs/operations/<market>/<batch>/<file>.csv \
 *     --apply-report=scripts/output/import-reports/<file>.<timestamp>.apply.json \
 *     --market=<market-slug> --market-name="<Market Name>" --batch=<batch-label> \
 *     --approver=<email of the person who approved publication> \
 *     --out=<path>.sql
 *
 * The apply report must list exactly the CSV's rows as inserted (same slugs, unique ids, all in --market); otherwise
 * nothing is written. Review the SQL, run the pre-publish gate (verifySeedVenues.ts --stage=prepublish), and only after
 * Wayne approves publication run:  supabase db query --linked -f <path>.sql
 */
import * as fs from "fs";
import * as path from "path";
import { readSeedCsv } from "../../src/lib/seeding/marketVenueImport";
import { buildGuardedPublishSql, planPublishTargets } from "../../src/lib/seeding/guardedPublishSql";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const fail = (msg: string): never => { console.error(`ERROR: ${msg}`); process.exit(1); };

const csvPath = arg("csv"), reportPath = arg("apply-report"), market = arg("market"), marketName = arg("market-name");
const batch = arg("batch"), approver = arg("approver"), out = arg("out");
if (!csvPath || !reportPath || !market || !marketName || !batch || !approver || !out) {
  fail("required: --csv --apply-report --market --market-name --batch --approver --out");
}

const { rows } = readSeedCsv(fs.readFileSync(path.resolve(csvPath!), "utf8"));
const csvRows = rows.map((r) => ({ slug: r.values.slug, city_slug: r.values.city_slug, market_slug: r.values.market_slug }));
const report = JSON.parse(fs.readFileSync(path.resolve(reportPath!), "utf8"));
const { targets, errors } = planPublishTargets(report, csvRows, market!);
if (errors.length) fail(`apply report and CSV do not match:\n  - ${errors.join("\n  - ")}`);

const sql = buildGuardedPublishSql(targets, { marketSlug: market!, marketName: marketName!, batchLabel: batch!, approverEmail: approver! });
fs.writeFileSync(path.resolve(out!), sql);
console.log(`Wrote ${out} — ${targets.length} venues:`);
for (const t of targets) console.log(`  ${t.id}  ${t.citySlug.padEnd(16)} ${t.slug}`);
console.log(`Expected result when run: published_now = targeted = ${targets.length}. Nothing was run.`);
