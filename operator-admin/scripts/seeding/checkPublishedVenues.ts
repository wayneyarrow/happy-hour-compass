/**
 * scripts/seeding/checkPublishedVenues.ts — logged-out Production check of newly PUBLISHED seed venues
 * (analytics blocked, venue local time zone).
 *
 * Usage (from operator-admin/):
 *   npx tsx scripts/seeding/checkPublishedVenues.ts --base=https://happyhourcompass.com \
 *     --csv=<reviewed import csv> --market=<market-slug> --expected-public-count=<N> \
 *     [--review-csv=<batch review csv>]   held venues from it must not appear
 *     [--exact-search="<venue name>"]      a full-name search must return exactly that card title
 *     [--cross-market=central-okanagan] [--time-zone=America/Los_Angeles]
 *
 * Per venue page: 200 + canonical, name + city, stock photo (page + og:image), Google rating badge + review count,
 * all 7 days of happy hour and business hours (expected values built from the CSV with the app's own parseHhTimes),
 * every offer with its price, no Verified badge. Market-wide: browsing count N, every live venue as a card and a map pin
 * (live names read from the database, read-only), name search in-market and cross-market, sitemap entries, no held
 * venue shown. Read-only. Exit code 1 on any failure.
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readSeedCsv } from "../../src/lib/seeding/marketVenueImport";
import { parseHhTimes } from "../../src/lib/data/venues";
import { blockAnalytics } from "./analyticsBlock";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = (arg("base") ?? "").replace(/\/$/, ""), csvPath = arg("csv"), market = arg("market"), expected = arg("expected-public-count");
const crossMarket = arg("cross-market") ?? "central-okanagan", tz = arg("time-zone") ?? "America/Los_Angeles";
if (!BASE || !csvPath || !market || !expected) { console.error("required: --base --csv --market --expected-public-count"); process.exit(1); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local"); process.exit(1); }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const t = (s: string, pad: boolean) => { const [h, m] = s.split(":").map(Number); const ap = h >= 12 && h < 24 ? "PM" : "AM"; const h12 = h % 12 || 12; return pad ? `${h12}:${String(m).padStart(2, "0")} ${ap}` : m ? `${h12}:${String(m).padStart(2, "0")} ${ap}` : `${h12} ${ap}`; };
const csv = readSeedCsv(fs.readFileSync(path.resolve(csvPath), "utf8")).rows.map((r) => r.values);
type Expected = Record<string, string> & { hh: Record<string, string>; hours: Record<string, string>; offers: { name: string; price?: string }[] };
const expect: Expected[] = csv.map((r) => {
  const w = parseHhTimes(r.hh_times); const bh = JSON.parse(r.business_hours);
  return { ...r,
    hh: Object.fromEntries(DAYS.map((d) => [d, (w[d] || []).map((x) => `${t(x.start, false)}–${t(x.end, false)}`).join(", ")])),
    hours: Object.fromEntries(DAYS.map((d) => { const x = bh[d.toLowerCase()]; return [d, x ? `${t(x.open, true)} - ${t(x.close, true)}` : "Closed"]; })),
    offers: [...JSON.parse(r.hh_food_details || "[]"), ...JSON.parse(r.hh_drink_details || "[]")] as { name: string; price?: string }[] } as Expected;
});
const held = arg("review-csv") ? readSeedCsv(fs.readFileSync(path.resolve(arg("review-csv")!), "utf8")).rows.map((r) => r.values).filter((r) => r.batch_status && r.batch_status !== "IN BATCH").map((r) => r.name) : [];
const exact = arg("exact-search");

const res: boolean[] = []; const fails: string[] = [];
const ck = (n: string, p: boolean, d = "") => { res.push(p); if (!p) fails.push(`${n}${d ? " — " + d : ""}`); console.log(`${p ? "PASS" : "FAIL"}  ${n}${d && !p ? "  — " + d : ""}`); };
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); if (i < 0) return null; const j = s.indexOf(b, i + a.length); return s.slice(i + a.length, j < 0 ? undefined : j); };
const dayMap = (block: string | null) => { const out: Record<string, string> = {}; if (!block) return out; const L = block.split("\n").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < L.length; i++) if (/^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/.test(L[i])) out[L[i]] = L[i + 1] || ""; return out; };
const fmtRating = (r: string) => { const x = Number(r); return Number.isInteger(x) ? x.toFixed(1) : String(x); };

(async () => {
  const db = createClient(URL_!, KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: mk } = await db.from("markets").select("id").eq("slug", market!).single();
  const { data: live } = await db.from("venues").select("name").eq("market_id", mk!.id).eq("is_published", true);
  const liveNames = (live ?? []).map((v) => v.name);

  const b = await chromium.launch(); let intercepted = 0;
  const open = async (mkt: string | null) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: tz }); const counter = await blockAnalytics(ctx);
    if (mkt) await ctx.addCookies([{ name: "hhc_market", value: mkt, url: BASE }]);
    return { ctx, counter };
  };
  {
    const { ctx, counter } = await open(market!);
    for (const v of expect) {
      const p = await ctx.newPage(); const url = `${BASE}/${market}/${v.city_slug}/${v.slug}`; const tag = `[${v.slug}]`;
      const r = await p.goto(url, { waitUntil: "networkidle" });
      for (const label of ["Show full schedule", "Show full hours"]) { const l = p.getByText(label, { exact: false }).first(); if (await l.count()) await l.click().catch(() => {}); }
      await p.waitForTimeout(500);
      const main = await p.locator("main").innerText();
      const canonical = await p.locator('link[rel="canonical"]').getAttribute("href");
      const imgs = await p.locator("main img").evaluateAll((els) => els.map((e) => decodeURIComponent((e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src || "")));
      const og = (await p.locator('meta[property="og:image"]').getAttribute("content")) || "";
      const count = Number(v.google_review_count).toLocaleString("en-US");
      ck(`${tag} 200 + canonical`, r?.status() === 200 && canonical === url, `${r?.status()} ${canonical}`);
      ck(`${tag} name + city`, main.includes(v.name) && main.includes(`· ${v.city}`));
      ck(`${tag} stock photo`, imgs.some((s) => s.includes(v.placeholder_image_path)) && og.includes(v.placeholder_image_path.split("/").pop()!), og);
      ck(`${tag} Google rating ${fmtRating(v.google_rating)} (${count})`, (await p.locator(`[aria-label="Google rating: ${fmtRating(v.google_rating)} out of 5"]`).count()) > 0 && main.includes(`(${count})`));
      const hh = dayMap(between(main, "full schedule", "OFFERS"));
      const hhBad = Object.entries(v.hh).filter(([d, e]) => (e ? hh[d] !== e : /\d/.test(hh[d] || ""))).map(([d, e]) => `${d}: "${hh[d]}" vs "${e}"`);
      ck(`${tag} happy hour (7 days)`, !hhBad.length, hhBad.join("; "));
      const hours = dayMap(between(main, "full hours", "ADDRESS"));
      const hBad = Object.entries(v.hours).filter(([d, e]) => (hours[d] || "").toLowerCase() !== e.toLowerCase()).map(([d, e]) => `${d}: "${hours[d]}" vs "${e}"`);
      ck(`${tag} business hours (7 days)`, !hBad.length, hBad.join("; "));
      const oBad = v.offers.filter((o) => !main.includes(o.name) || (o.price && ![o.price, String(Number(o.price)), Number(o.price).toFixed(2)].some((x) => main.includes(`${o.name} — $${x}`)))).map((o) => o.name);
      ck(`${tag} ${v.offers.length} offers with prices`, !oBad.length, oBad.join("; "));
      ck(`${tag} no Verified badge`, !/Verified Venue/.test(main));
      await p.close();
    }
    intercepted += counter.intercepted; await ctx.close();
  }
  {
    const { ctx, counter } = await open(market!); const p = await ctx.newPage();
    await p.goto(`${BASE}/website-happy-hours`, { waitUntil: "networkidle" });
    for (let i = 0; i < 16; i++) { await p.mouse.wheel(0, 2000); await p.waitForTimeout(300); }
    const main = await p.locator("main").innerText(); const count = (main.match(/\b(\d+)\s+venues?\b/) || [])[0];
    const cards = new Set(await p.locator("article h3").allInnerTexts());
    ck(`${market} browsing shows ${expected} venues`, count === `${expected} venues`, String(count));
    const missing = liveNames.filter((n) => !cards.has(n)); ck(`all ${liveNames.length} live venues are browsing cards`, !missing.length, missing.join(", "));
    const heldShown = held.filter((n) => cards.has(n)); ck("no held venue in browsing", !heldShown.length, heldShown.join(", "));
    const pins = new Set((await p.locator(".gm-style [title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")))).filter(Boolean));
    const noPin = liveNames.filter((n) => !pins.has(n)); ck(`map pins for all ${liveNames.length} live venues`, !noPin.length, noPin.join(", "));
    const input = p.getByPlaceholder("Search by name, type, or specials…"); const notFound: string[] = [];
    for (const v of expect) { await input.fill(v.name); await p.waitForTimeout(1000); if (!(await p.locator("article:visible h3").allInnerTexts()).includes(v.name)) notFound.push(v.name); }
    ck(`in-market name search finds each of the ${expect.length}`, !notFound.length, notFound.join(", "));
    if (exact) { await input.fill(exact); await p.waitForTimeout(1200); const hits = await p.locator("article:visible h3").allInnerTexts(); ck(`search "${exact}" returns that exact listing`, hits.includes(exact), JSON.stringify([...new Set(hits)])); }
    intercepted += counter.intercepted; await ctx.close();
  }
  {
    const { ctx, counter } = await open(crossMarket); const p = await ctx.newPage();
    await p.goto(`${BASE}/website-happy-hours`, { waitUntil: "networkidle" });
    const input = p.getByPlaceholder("Search by name, type, or specials…"); const notFound: string[] = [];
    for (const v of expect) { await input.fill(v.name); await p.waitForTimeout(1000); if (!(await p.locator("article:visible h3").allInnerTexts()).includes(v.name)) notFound.push(v.name); }
    ck(`cross-market (${crossMarket}) name search finds each of the ${expect.length}`, !notFound.length, notFound.join(", "));
    intercepted += counter.intercepted; await ctx.close();
  }
  {
    const { ctx, counter } = await open(null); const sm = await (await ctx.request.get(`${BASE}/sitemap.xml`)).text();
    const miss = expect.filter((v) => !sm.includes(`${BASE}/${market}/${v.city_slug}/${v.slug}`)).map((v) => v.slug);
    ck(`sitemap lists all ${expect.length} venue URLs`, !miss.length, miss.join(", "));
    intercepted += counter.intercepted; await ctx.close();
  }
  console.log(`\nanalytics: ${intercepted} tracking requests reached the network layer (answered locally, none sent)`);
  console.log(`${res.filter(Boolean).length}/${res.length} checks passed`); if (fails.length) console.log("FAILURES:\n" + fails.join("\n"));
  await b.close(); process.exit(res.every(Boolean) ? 0 : 1);
})();
