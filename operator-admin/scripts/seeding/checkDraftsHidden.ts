/**
 * scripts/seeding/checkDraftsHidden.ts — logged-out check that imported DRAFTS are not public (analytics blocked).
 *
 * Usage (from operator-admin/):
 *   npx tsx scripts/seeding/checkDraftsHidden.ts --base=https://happyhourcompass.com \
 *     --csv=<reviewed import csv> --market=<market-slug> --expected-public-count=<N> [--cross-market=central-okanagan]
 *
 * Passes when: the market's browsing count equals N, no draft appears as a browsing card or on the homepage, name
 * search (in-market and cross-market) returns no card titled exactly like a draft, every draft URL returns 404, and no
 * draft slug is in the sitemap. Read-only (browser GETs only). Exit code 1 on any failure.
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";
import { readSeedCsv } from "../../src/lib/seeding/marketVenueImport";
import { blockAnalytics } from "./analyticsBlock";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = (arg("base") ?? "").replace(/\/$/, ""), csvPath = arg("csv"), market = arg("market"), expected = arg("expected-public-count");
const crossMarket = arg("cross-market") ?? "central-okanagan";
if (!BASE || !csvPath || !market || !expected) { console.error("required: --base --csv --market --expected-public-count"); process.exit(1); }
const drafts = readSeedCsv(fs.readFileSync(path.resolve(csvPath), "utf8")).rows.map((r) => ({ name: r.values.name, slug: r.values.slug, city: r.values.city_slug }));
const SEARCH = "Search by name, type, or specials…";

const res: boolean[] = [];
const ck = (n: string, p: boolean, d = "") => { res.push(p); console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const titles = async (p: Page) => [...new Set(await p.locator("article:visible h3").allInnerTexts())];

(async () => {
  const b = await chromium.launch(); let intercepted = 0;
  const open = async (mkt: string | null) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const counter = await blockAnalytics(ctx);
    if (mkt) await ctx.addCookies([{ name: "hhc_market", value: mkt, url: BASE }]);
    return { ctx, counter };
  };
  const searchHits = async (p: Page) => {
    const input = p.getByPlaceholder(SEARCH); const hits: string[] = [];
    for (const d of drafts) { await input.fill(d.name); await p.waitForTimeout(1000); if ((await titles(p)).includes(d.name)) hits.push(d.name); }
    await input.fill(""); return hits;
  };
  {
    const { ctx, counter } = await open(market!); const p = await ctx.newPage();
    await p.goto(`${BASE}/website-happy-hours`, { waitUntil: "networkidle" });
    for (let i = 0; i < 14; i++) { await p.mouse.wheel(0, 2000); await p.waitForTimeout(300); }
    const main = await p.locator("main").innerText(); const count = (main.match(/\b(\d+)\s+venues?\b/) || [])[0];
    const cards = new Set(await p.locator("article h3").allInnerTexts());
    ck(`${market} browsing shows ${expected} venues`, count === `${expected} venues`, String(count));
    const inBrowse = drafts.filter((d) => cards.has(d.name)); ck("no draft as a browsing card", !inBrowse.length, inBrowse.map((d) => d.name).join(", "));
    const hits = await searchHits(p); ck("in-market name search finds no draft", !hits.length, hits.join(", "));
    await p.goto(`${BASE}/`, { waitUntil: "networkidle" }); const home = await p.locator("main").innerText();
    const onHome = drafts.filter((d) => home.includes(d.name)); ck("no draft on the homepage", !onHome.length, onHome.map((d) => d.name).join(", "));
    intercepted += counter.intercepted; await ctx.close();
  }
  {
    const { ctx, counter } = await open(crossMarket); const p = await ctx.newPage();
    await p.goto(`${BASE}/website-happy-hours`, { waitUntil: "networkidle" });
    const hits = await searchHits(p); ck(`cross-market (${crossMarket}) name search finds no draft`, !hits.length, hits.join(", "));
    intercepted += counter.intercepted; await ctx.close();
  }
  {
    const { ctx, counter } = await open(market!); const bad: string[] = [];
    for (const d of drafts) { const r = await ctx.request.get(`${BASE}/${market}/${d.city}/${d.slug}`, { maxRedirects: 0 }); if (r.status() !== 404) bad.push(`${d.slug}:${r.status()}`); }
    ck(`all ${drafts.length} draft URLs return 404`, !bad.length, bad.join(", "));
    const sm = await (await ctx.request.get(`${BASE}/sitemap.xml`)).text();
    const inSm = drafts.filter((d) => sm.includes(`/${d.slug}<`) || sm.includes(`/${d.slug}"`)).map((d) => d.slug);
    ck("no draft slug in the sitemap", !inSm.length, inSm.join(", "));
    intercepted += counter.intercepted; await ctx.close();
  }
  console.log(`\nanalytics: ${intercepted} tracking requests reached the network layer (answered locally, none sent)`);
  console.log(`${res.filter(Boolean).length}/${res.length} passed`);
  await b.close(); process.exit(res.every(Boolean) ? 0 : 1);
})();
