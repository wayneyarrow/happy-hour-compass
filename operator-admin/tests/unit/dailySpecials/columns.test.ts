import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAILY_SPECIAL_COLUMNS } from "../../../src/app/admin/daily-specials/columns";

/**
 * Regression coverage for the /admin/daily-specials runtime crash:
 * "(intermediate value)(intermediate value)(intermediate value).split is
 * not a function" at `.from("daily_specials").select(DAILY_SPECIAL_COLUMNS)`
 * in page.tsx.
 *
 * ROOT CAUSE: DAILY_SPECIAL_COLUMNS was always a real string at its
 * definition site — the bug was never about its VALUE. It was defined
 * inside DailySpecialsManager.tsx ("use client") and imported into
 * page.tsx (a Server Component). Next.js's React Server Components
 * client-boundary transform replaces a "use client" module's exports with
 * client-reference objects on the SERVER build — so page.tsx received a
 * reference object, not the string, and Supabase's query builder (which
 * calls string methods like `.split(',')` internally) threw.
 *
 * WHY THIS NEEDS TWO KINDS OF TEST: a plain node:test/tsx run has no
 * concept of Next.js's "use client" RSC boundary transform at all — Node
 * always sees the real exported value regardless of which module it came
 * from. So a pure "is DAILY_SPECIAL_COLUMNS a valid string" test (below)
 * would have passed even on the ORIGINAL buggy code, and cannot by itself
 * catch a regression back to importing it across the client boundary. The
 * second test group here is a deliberate, narrow source check on the
 * import path — not a source-text check of arbitrary code shape — because
 * that structural fact (import from a boundary-neutral module, not a "use
 * client" one) is the actual fix and the only thing that can regress.
 */

// ─────────────────────────────────────────────────────────────────────────
// 1. DAILY_SPECIAL_COLUMNS is a valid Supabase .select() string
// ─────────────────────────────────────────────────────────────────────────

test("DAILY_SPECIAL_COLUMNS is a non-empty string (not an array, object, or reference of any kind)", () => {
  assert.equal(typeof DAILY_SPECIAL_COLUMNS, "string");
  assert.ok(DAILY_SPECIAL_COLUMNS.length > 0);
});

test("DAILY_SPECIAL_COLUMNS splits into well-formed, non-empty column names — exactly what Supabase's query builder does internally", () => {
  const columns = DAILY_SPECIAL_COLUMNS.split(",").map((c) => c.trim());
  assert.ok(columns.length > 1, "expected more than one column");
  for (const col of columns) {
    assert.ok(col.length > 0, "no empty column name segments (e.g. from a stray trailing comma)");
    assert.match(col, /^[a-z_]+$/, `column name "${col}" is not a plain snake_case identifier`);
  }
});

test("DAILY_SPECIAL_COLUMNS includes every field the Operator Admin form/list actually reads", () => {
  const columns = DAILY_SPECIAL_COLUMNS.split(",").map((c) => c.trim());
  for (const expected of [
    "id", "venue_id", "title", "offer_type", "short_summary", "description",
    "conditions", "image_url", "schedule_type", "one_time_date", "days_of_week",
    "recurrence_start_date", "recurrence_end_date", "time_mode", "start_time",
    "end_mode", "end_time", "is_published", "is_seeded_special",
    "created_by_operator_id", "updated_by_operator_id", "created_at", "updated_at",
  ]) {
    assert.ok(columns.includes(expected), `missing expected column: ${expected}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Structural guard against reintroducing the cross-boundary import
// ─────────────────────────────────────────────────────────────────────────

const COLUMNS_MODULE_PATH = join(
  __dirname,
  "../../../src/app/admin/daily-specials/columns.ts"
);
const COLUMNS_MODULE_SOURCE = readFileSync(COLUMNS_MODULE_PATH, "utf8");

const PAGE_PATH = join(__dirname, "../../../src/app/admin/daily-specials/page.tsx");
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");

const MANAGER_PATH = join(__dirname, "../../../src/app/admin/daily-specials/DailySpecialsManager.tsx");
const MANAGER_SOURCE = readFileSync(MANAGER_PATH, "utf8");

test("columns.ts (where DAILY_SPECIAL_COLUMNS is defined) has no \"use client\" or \"use server\" directive — it must stay boundary-neutral", () => {
  const firstLine = COLUMNS_MODULE_SOURCE.trimStart().split("\n")[0];
  assert.doesNotMatch(firstLine, /use client|use server/);
});

test("page.tsx (a Server Component) imports DAILY_SPECIAL_COLUMNS from the boundary-neutral ./columns module", () => {
  assert.match(PAGE_SOURCE, /import \{ DAILY_SPECIAL_COLUMNS \} from "\.\/columns";/);
});

test("page.tsx does NOT import DAILY_SPECIAL_COLUMNS from DailySpecialsManager (a \"use client\" module) — the exact regression this test exists to catch", () => {
  assert.doesNotMatch(PAGE_SOURCE, /DAILY_SPECIAL_COLUMNS[^;]*from ["']\.\/DailySpecialsManager["']/);
  // Belt-and-suspenders: no import line naming both the default export and
  // DAILY_SPECIAL_COLUMNS together from DailySpecialsManager at all.
  assert.doesNotMatch(PAGE_SOURCE, /import DailySpecialsManager, \{ DAILY_SPECIAL_COLUMNS/);
});

// DailySpecialsManager.tsx no longer imports DAILY_SPECIAL_COLUMNS at all
// (as of the impersonation-save-fix correction task): its refreshList() no
// longer queries `daily_specials` directly through the browser Supabase
// client — that was the source of a SEPARATE bug (the browser client stays
// authenticated as the founder's own session during impersonation, so it
// silently got zero rows back from Daily Specials' venue-ownership-scoped
// RLS policy). It now calls getDailySpecialsForActiveVenueAction()
// (actions.ts), a server action that resolves the correct identity via
// resolveOperatorContext() and selects its own DAILY_SPECIAL_LIST_COLUMNS
// string server-side — so there is no client-boundary "use client" -> server
// import of DAILY_SPECIAL_COLUMNS through Manager anymore at all. This does
// not reopen the original .split() crash this file protects against: that
// bug was specifically about page.tsx (a Server Component) importing the
// constant FROM a "use client" module — Manager no longer touches
// DAILY_SPECIAL_COLUMNS in either direction, and page.tsx's own import from
// the boundary-neutral ./columns module (tested above) is unchanged.
test("DailySpecialsManager.tsx (\"use client\") no longer imports DAILY_SPECIAL_COLUMNS or defines its own copy — it no longer queries daily_specials directly through the browser client at all", () => {
  assert.doesNotMatch(MANAGER_SOURCE, /DAILY_SPECIAL_COLUMNS/);
  assert.doesNotMatch(MANAGER_SOURCE, /export const DAILY_SPECIAL_COLUMNS/);
});

test("DailySpecialsManager.tsx no longer imports the browser Supabase client — every daily_specials read/write goes through a server action", () => {
  assert.doesNotMatch(MANAGER_SOURCE, /from "@\/lib\/supabase\/browser"/);
});

test("DailySpecialsManager.tsx's refreshList reads through getDailySpecialsForActiveVenueAction, not a direct .from(\"daily_specials\") browser query", () => {
  assert.match(MANAGER_SOURCE, /getDailySpecialsForActiveVenueAction/);
  assert.doesNotMatch(MANAGER_SOURCE, /\.from\("daily_specials"\)/);
});
