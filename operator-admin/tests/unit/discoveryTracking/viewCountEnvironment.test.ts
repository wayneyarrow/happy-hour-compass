import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { COUNTED_VIEW_ENVIRONMENT_FILTER } from "../../../src/lib/analyticsEnvironment";
import { LEGACY_DISCOVER_CLICK_ENVIRONMENT_FILTER } from "../../../src/lib/discoveryTracking/venueDiscoveryMetrics";

/**
 * Migration 111 + its paired code change: every venue/event view count
 * includes legacy (environment NULL) and production rows and excludes rows
 * explicitly labelled staging / preview / development.
 *
 * Static checks only (no database). The SQL behaviour itself was verified
 * by running the real 088 + 111 files in a disposable in-memory Postgres
 * (PGlite) — see the implementation report.
 */

const ROOT = join(__dirname, "../../../..");
const SRC = join(ROOT, "operator-admin/src");
const M088 = readFileSync(join(ROOT, "supabase/migrations/088_view_event_aggregation_rpcs.sql"), "utf8");
const M111 = readFileSync(join(ROOT, "supabase/migrations/111_view_counts_exclude_non_production.sql"), "utf8");
const code = (s: string) => s.replace(/--.*$/gm, "");

function fnHeader(src: string, name: string): string {
  const m = code(src).match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$`));
  assert.ok(m, name);
  return m[0].replace(/\s+/g, " ");
}
function fnBody(src: string, name: string): string {
  const s = code(src);
  const start = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const body = s.slice(s.indexOf("AS $$", start), s.indexOf("$$;", start));
  return body.replace(/\s+/g, " ");
}

test("the counted-views rule is NULL or production, shared with legacy discover clicks", () => {
  assert.equal(COUNTED_VIEW_ENVIRONMENT_FILTER, "environment.is.null,environment.eq.production");
  assert.equal(LEGACY_DISCOVER_CLICK_ENVIRONMENT_FILTER, COUNTED_VIEW_ENVIRONMENT_FILTER);
});

test("migration 111 keeps both functions' headers identical to 088 (signature, defaults, return, language, STABLE, SECURITY DEFINER, search_path)", () => {
  for (const fn of ["venue_view_counts", "event_view_counts"]) {
    assert.equal(fnHeader(M111, fn), fnHeader(M088, fn), fn);
  }
});

test("migration 111 changes each body by exactly the environment predicate", () => {
  const PRED = " AND (e.environment IS NULL OR e.environment = 'production')";
  for (const fn of ["venue_view_counts", "event_view_counts"]) {
    const before = fnBody(M088, fn);
    const after = fnBody(M111, fn);
    assert.ok(after.includes(PRED), fn);
    assert.equal(after.replace(PRED, ""), before, fn);
  }
});

test("migration 111 keeps 088's permissions and touches no table or row", () => {
  const grants = (s: string) => code(s).split("\n").filter((l) => /^(REVOKE|GRANT)\s/.test(l.trim())).map((l) => l.trim().replace(/\s+/g, " "));
  assert.deepEqual(grants(M111), grants(M088));
  assert.doesNotMatch(code(M111), /\b(CREATE|ALTER|DROP)\s+TABLE\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bTRUNCATE\b/i);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : /\.(ts|tsx)$/.test(n) ? [f] : [];
  });
}

test("every direct read of venue_view_events / event_view_events applies the counted-views filter", () => {
  let reads = 0;
  for (const f of walk(SRC)) {
    const s = readFileSync(f, "utf8");
    const re = /\.from\("(venue_view_events|event_view_events)"\)([\s\S]{0,400}?)(?=\n\s*(?:[,;)\]]|\/\/|admin\b|supabase\b)|$)/g;
    for (const m of s.matchAll(re)) {
      const chain = m[2];
      if (/\.insert\(|insertTrackingRow/.test(chain)) continue; // writers
      reads++;
      assert.match(chain, /\.or\(COUNTED_VIEW_ENVIRONMENT_FILTER\)/, `${relative(SRC, f)}: ${m[1]} read without the environment filter`);
    }
  }
  assert.equal(reads, 6, "expected the 6 known direct reads (operatorAnalyticsV2 ×2, venueHealth ×3, searchDiscoveryReport countVenueViews ×1)");
});

test("every other view count goes through the filtered RPCs", () => {
  const s = readFileSync(join(SRC, "lib/data/viewCounts.ts"), "utf8");
  assert.match(s, /\.rpc\("venue_view_counts"/);
  assert.match(s, /\.rpc\("event_view_counts"/);
  // Customer Success milestones, Platform Analytics, Action Center, specials adoption,
  // Today's Specials ranking and activation follow-up all use getVenueViewCounts().
  for (const f of [
    "lib/customerSuccess/detectVenueViewMilestones.ts",
    "lib/data/founderDashboard.ts",
    "lib/data/actionCenter.ts",
    "lib/data/specialsAdoption.ts",
    "lib/data/todaysSpecialsHomepage.ts",
    "lib/activation/activationExpiryFollowUp.ts",
  ]) {
    const src = readFileSync(join(SRC, f), "utf8");
    assert.match(src, /getVenueViewCounts\(/, f);
    assert.doesNotMatch(src, /\.from\("venue_view_events"\)/, f);
  }
});
