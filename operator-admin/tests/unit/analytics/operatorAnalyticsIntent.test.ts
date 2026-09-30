import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Operator Admin Intent cards read venue_click_events through
 * getOperatorAnalyticsV2(). Runs the real function against an in-memory
 * PostgREST fake (global fetch stub on a non-routable host) — no database.
 */

const FAKE_URL = "http://supabase.test.invalid";
const VENUE = "3f2b8c1e-5d4a-4e6f-9a1b-2c3d4e5f6a7b";
const OTHER_VENUE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

type ClickRow = { venue_id: string; click_type: string; clicked_at: string };
const clicks: ClickRow[] = [
  { venue_id: VENUE, click_type: "website", clicked_at: ago(DAY) },
  { venue_id: VENUE, click_type: "website", clicked_at: ago(2 * DAY) },
  { venue_id: VENUE, click_type: "menu", clicked_at: ago(3 * DAY) },
  { venue_id: VENUE, click_type: "hh_schedule_expand", clicked_at: ago(60_000) },
  { venue_id: VENUE, click_type: "hh_schedule_expand", clicked_at: ago(29 * DAY) },
  { venue_id: VENUE, click_type: "hh_schedule_expand", clicked_at: ago(31 * DAY) }, // outside window
  { venue_id: VENUE, click_type: "business_hours_expand", clicked_at: ago(5 * DAY) },
  { venue_id: OTHER_VENUE, click_type: "website", clicked_at: ago(DAY) }, // other venue
];

const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const requestedHosts = new Set<string>();

before(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) saved[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SECRET_KEY = "test-only-not-a-key";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requestedHosts.add(url.host);
    const table = url.pathname.replace("/rest/v1/", "");
    let rows: Record<string, string>[] = [];
    if (table === "venue_click_events") {
      rows = clicks.filter((row) =>
        [...url.searchParams.entries()].every(([col, filter]) => {
          if (col === "select") return true;
          const [op, value] = [filter.slice(0, filter.indexOf(".")), filter.slice(filter.indexOf(".") + 1)];
          const actual = (row as Record<string, string>)[col];
          if (op === "eq") return actual === value;
          if (op === "gte") return Date.parse(actual) >= Date.parse(value);
          throw new Error(`unsupported filter ${col}=${filter}`);
        })
      );
    }
    const method = (init?.method ?? "GET").toUpperCase();
    return new Response(method === "HEAD" ? null : JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` },
    });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("stored Intent events are counted per type, scoped to the venue and the 30-day window", async () => {
  const { getOperatorAnalyticsV2 } = await import("../../../src/lib/data/operatorAnalyticsV2");
  const data = await getOperatorAnalyticsV2(VENUE, []);
  assert.equal(data.websiteClicks, 2);
  assert.equal(data.menuClicks, 1);
  assert.equal(data.hhScheduleExpands, 2);
  assert.equal(data.businessHoursExpands, 1);
  assert.deepEqual([...requestedHosts], [new URL(FAKE_URL).host], "must never reach a real Supabase host");
});

test("Intent is plan-independent: no plan input to the query and no plan gate on the section", () => {
  const src = readFileSync(join(__dirname, "../../../src/lib/data/operatorAnalyticsV2.ts"), "utf8");
  assert.match(src, /export async function getOperatorAnalyticsV2\(\s*venueId: string,\s*venueTags: string\[\]\s*\)/);

  const page = readFileSync(join(__dirname, "../../../src/app/admin/analytics/page.tsx"), "utf8");
  const intent = page.slice(page.indexOf("Section 3: Intent"));
  const section = intent.slice(0, intent.indexOf("</SectionCard>"));
  assert.match(section, /<StatCard label="Website Clicks" value=\{data\.websiteClicks\} \/>/);
  assert.doesNotMatch(section, /isProOrMore|isPremium|UpgradeNote|locked/);
});
