/**
 * scripts/importMarketVenuesFromCsv.ts
 *
 * Market-aware seed venue importer — DRAFT-ONLY, INSERT-ONLY.
 * Logic lives in src/lib/seeding/marketVenueImport.ts (planning, validation,
 * duplicate detection); this file only loads existing state, prints the
 * report, and — with --apply — inserts the rows the plan marked "insert".
 *
 * Usage (from operator-admin/):
 *   npm run import:market-venues -- --market=greater-san-diego --csv=<path>             ← dry run (default, read-only)
 *   npm run import:market-venues -- --market=greater-san-diego --csv=<path> --apply     ← insert drafts
 *
 * Optional: --report=<path.json> (default: scripts/output/import-reports/<csv>.<timestamp>.<mode>.json, gitignored)
 *
 * Dry run makes zero writes: it only SELECTs markets, cities, venues and
 * venue_slug_history. --apply never updates or deletes, never sets
 * is_published = true, and skips any row whose slug or Place ID already
 * exists — re-running the same batch therefore inserts nothing new.
 *
 * Staging and Production share ONE Supabase project: --apply writes to both.
 * Run it only with Wayne's explicit approval, after reviewing the dry run.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  applyImportPlan,
  planImport,
  readSeedCsv,
  type ExistingState,
  type ImportPlan,
  type VenueInsertRecord,
  type VenueInsertStore,
} from "../src/lib/seeding/marketVenueImport";
import { ESTABLISHMENT_TYPE_OPTIONS } from "../src/app/admin/venue/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const APPLY = process.argv.includes("--apply");
const MARKET = arg("market");
const CSV = arg("csv");

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!MARKET) fail("--market=<market-slug> is required");
if (!CSV) fail("--csv=<path> is required");
const csvPath = path.resolve(process.cwd(), CSV);
if (!fs.existsSync(csvPath)) fail(`CSV not found: ${csvPath}`);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loadExisting(): Promise<ExistingState> {
  const [markets, cities, venues, history] = await Promise.all([
    supabase.from("markets").select("id, slug, status, country, province, center_lat, center_lng, radius_km"),
    supabase.from("cities").select("id, slug, name, market_id, status, center_lat, center_lng"),
    // Small table (hundreds of rows): load all so slug/Place ID/address/name
    // duplicates are found in every market, including unassigned venues.
    supabase.from("venues").select("id, slug, name, place_id, address_line1, city, is_published").range(0, 9999),
    supabase.from("venue_slug_history").select("old_slug").range(0, 9999),
  ]);
  for (const [label, r] of [["markets", markets], ["cities", cities], ["venues", venues], ["venue_slug_history", history]] as const) {
    if (r.error) fail(`could not read ${label}: ${r.error.message}`);
  }
  const venueRows = venues.data ?? [];
  if (venueRows.length >= 10000) fail("venues exceeds 10,000 rows — add pagination before importing");
  return {
    markets: markets.data ?? [],
    cities: cities.data ?? [],
    venues: venueRows,
    historicalSlugs: (history.data ?? []).map((h) => h.old_slug as string),
  };
}

const supabaseStore: VenueInsertStore = {
  async insertVenue(record: VenueInsertRecord) {
    const { data, error } = await supabase.from("venues").insert(record).select("id").single();
    if (error || !data) {
      return { ok: false, uniqueViolation: error?.code === "23505", message: error?.message ?? "no row returned" };
    }
    return { ok: true, id: data.id as string };
  },
};

function printPlan(plan: ImportPlan) {
  for (const i of plan.headerIssues) console.log(`  HEADER ${i.level.toUpperCase()} [${i.code}] ${i.message}`);
  for (const r of plan.rows) {
    const s = r.summary;
    console.log(
      `\n  Row ${r.rowNumber}  ${r.decision.toUpperCase().padEnd(13)} ${r.slug}  — ${r.name}` +
        `\n    city=${s.city}  hh_days=${s.hhDays.length ? s.hhDays.join(",") : "none"}  food=${s.foodItems} drink=${s.drinkItems}  coords=${s.hasCoordinates ? "yes" : "no"}`
    );
    const e = r.eligibility;
    console.log(`    business hours: ${e.businessHours.toUpperCase()}${e.businessHoursReasons.length ? " — " + e.businessHoursReasons.join(" | ") : ""}`);
    console.log(`    city assignment: ${e.geography === "resolved" ? "RESOLVED" : "BLOCKED — " + e.geographyReasons.join(" | ")}`);
    if (r.existingVenue) console.log(`    existing: ${r.existingVenue.name} (${r.existingVenue.slug}, matched on ${r.existingVenue.matchedOn}) — untouched`);
    for (const i of r.issues) console.log(`    ${i.level === "error" ? "✖" : "!"} [${i.code}] ${i.message}`);
  }
  console.log(`\n  Summary: insert ${plan.counts.insert} · skip (existing) ${plan.counts.skip_existing} · blocked ${plan.counts.blocked}`);
  const hoursIneligible = plan.rows.filter((r) => r.eligibility.businessHours === "ineligible").length;
  const geoBlocked = plan.rows.filter((r) => r.eligibility.geography === "blocked").length;
  console.log(`  Business hours: ${plan.rows.length - hoursIneligible} eligible · ${hoursIneligible} ineligible  |  City assignment: ${plan.rows.length - geoBlocked} resolved · ${geoBlocked} blocked`);
}

async function main() {
  console.log(`\n=== importMarketVenuesFromCsv [${APPLY ? "APPLY — draft inserts" : "DRY RUN — no writes"}] ===`);
  console.log(`  market: ${MARKET}\n  csv:    ${csvPath}`);

  const { header, rows } = readSeedCsv(fs.readFileSync(csvPath, "utf8"));
  const state = await loadExisting();
  const publicDir = path.resolve(process.cwd(), "public");
  const plan = planImport(header, rows, state, {
    marketSlug: MARKET as string,
    establishmentTypes: ESTABLISHMENT_TYPE_OPTIONS,
    placeholderExists: (rel) => fs.existsSync(path.join(publicDir, rel)),
  });
  printPlan(plan);

  const report: Record<string, unknown> = {
    mode: APPLY ? "apply" : "dry-run",
    ranAt: new Date().toISOString(),
    market: MARKET,
    csv: csvPath,
    counts: plan.counts,
    headerIssues: plan.headerIssues,
    rows: plan.rows.map(({ record, ...r }) => ({ ...r, wouldInsert: record ?? null })),
  };

  if (APPLY) {
    if (plan.headerIssues.some((i) => i.level === "error")) fail("header invalid — nothing inserted");
    const results = await applyImportPlan(plan, supabaseStore);
    for (const r of results) console.log(`  ${r.outcome.toUpperCase().padEnd(8)} row ${r.rowNumber} ${r.slug}${r.id ? ` → ${r.id}` : ""}${r.message ? ` (${r.message})` : ""}`);
    report.results = results;
    if (results.some((r) => r.outcome === "failed")) process.exitCode = 1;
  } else {
    console.log("\n  Dry run only — nothing was written. Re-run with --apply (after approval) to insert drafts.");
  }

  // Reports default to the gitignored scripts/output/ (inputs may live in tracked docs/).
  const reportPath =
    arg("report") ??
    path.resolve(
      process.cwd(),
      "scripts/output/import-reports",
      `${path.basename(csvPath).replace(/\.csv$/i, "")}.${new Date().toISOString().replace(/[:.]/g, "-")}.${APPLY ? "apply" : "dry-run"}.json`
    );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  Report: ${reportPath}\n`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
