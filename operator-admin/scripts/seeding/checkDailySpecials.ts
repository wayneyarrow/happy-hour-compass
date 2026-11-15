/**
 * scripts/seeding/checkDailySpecials.ts — logged-out browser check of a Daily Specials seed batch (analytics blocked).
 * Adapted from checkDraftsHidden.ts / checkPublishedVenues.ts for content that has no URL of its own: every public
 * surface links a special as `<venue path>#daily-special-<id>` and the venue page renders `id="daily-special-<id>"`,
 * so the checks key on the batch's exact IDs, not on titles.
 *
 * Usage (from operator-admin/):
 *   npx tsx scripts/seeding/checkDailySpecials.ts --base=https://happyhourcompass.com --batch=<dir>/batch.json \
 *     --stage=draft|published [--ids=<file with the imported IDs, one per line>] [--cross-market=central-okanagan]
 *
 * draft:     every batch venue page loads (200) and shows none of the batch IDs; the market's /website-daily-specials
 *            page, the market homepage and the cross-market specials page link none of them.
 * published: every batch venue page shows each of its IDs with the title; the market specials page links every ID.
 * Read-only (browser GETs + one DB read for city slugs). Exit 1 on any failure.
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { blockAnalytics } from "./analyticsBlock";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const BASE = (arg("base") ?? "").replace(/\/$/, ""), stage = arg("stage"), batchPath = arg("batch"), cross = arg("cross-market") ?? "central-okanagan";
if (!BASE || !batchPath || !["draft", "published"].includes(stage ?? "")) { console.error("required: --base --batch --stage=draft|published"); process.exit(1); }
const batch = JSON.parse(fs.readFileSync(batchPath!, "utf8"));
const only = arg("ids") ? new Set(fs.readFileSync(arg("ids")!, "utf8").split(/\s+/).filter(Boolean)) : null;
const rows: any[] = batch.rows.filter((r: any) => !only || only.has(r.id));
const res: boolean[] = []; const ck = (n: string, p: boolean, d = "") => { res.push(p); console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d.slice(0, 400) : ""}`); };
const anchors = async (p: Page) => p.evaluate(() => [...document.querySelectorAll("[id^='daily-special-'], a[href*='#daily-special-']")]
  .map((e) => (e.id || (e.getAttribute("href") ?? "").split("#daily-special-")[1] || "").replace(/^daily-special-/, "")));
const scrollAll = async (p: Page) => { for (let i = 0; i < 20; i++) { await p.mouse.wheel(0, 2500); await p.waitForTimeout(250); } };

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { data: vs, error } = await db.from("venues").select("id, slug, cities(slug)").in("id", [...new Set(rows.map((r) => r.venue_id))]);
  if (error) throw error;
  const vpath = new Map((vs as any[]).map((v) => [v.id, `/${batch.market}/${v.cities.slug}/${v.slug}`]));
  const ids = new Set(rows.map((r) => r.id));
  const b = await chromium.launch(); let intercepted = 0;
  const open = async (mkt: string): Promise<{ ctx: BrowserContext; counter: { intercepted: number } }> => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const counter = await blockAnalytics(ctx);
    await ctx.addCookies([{ name: "hhc_market", value: mkt, url: BASE }]); return { ctx, counter }; };
  {
    const { ctx, counter } = await open(batch.market); const p = await ctx.newPage();
    const byVenue = new Map<string, any[]>(); for (const r of rows) byVenue.set(r.venue_id, [...(byVenue.get(r.venue_id) ?? []), r]);
    const bad: string[] = [];
    for (const [vid, rs] of byVenue) {
      const resp = await p.goto(`${BASE}${vpath.get(vid)}`, { waitUntil: "networkidle", timeout: 60000 });
      if (resp?.status() !== 200) { bad.push(`${vpath.get(vid)} HTTP ${resp?.status()}`); continue; }
      await scrollAll(p); const found = new Set(await anchors(p)); const text = await p.locator("main").innerText();
      for (const r of rs) {
        if (stage === "draft" && found.has(r.id)) bad.push(`${r.venue_slug}: draft ${r.title} visible`);
        if (stage === "published" && (!found.has(r.id) || !text.includes(r.title))) bad.push(`${r.venue_slug}: ${r.title} missing`);
      }
    }
    ck(`${byVenue.size} venue pages ${stage === "draft" ? "show none of the" : "show all"} ${rows.length} batch specials`, !bad.length, bad.join("; "));
    await p.goto(`${BASE}/website-daily-specials`, { waitUntil: "networkidle", timeout: 60000 }); await scrollAll(p);
    const listed = new Set((await anchors(p)).filter((x) => ids.has(x))); const main = await p.locator("main").innerText();
    const count = (main.match(/\b\d+\s+(daily\s+)?specials?\b/i) || [""])[0];
    if (stage === "draft") ck(`${batch.market} /website-daily-specials links none of the batch`, listed.size === 0, `${listed.size} linked; page says "${count}"`);
    else ck(`${batch.market} /website-daily-specials links all ${ids.size}`, listed.size === ids.size, `${listed.size} linked; page says "${count}"`);
    await p.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 }); await scrollAll(p);
    const onHome = (await anchors(p)).filter((x) => ids.has(x));
    if (stage === "draft") ck(`${batch.market} homepage links none of the batch`, onHome.length === 0, String(onHome.length));
    else console.log(`info  ${batch.market} homepage links ${onHome.length} batch specials (Today's Specials shows only today's)`);
    intercepted += counter.intercepted; await ctx.close();
  }
  if (stage === "draft") {
    const { ctx, counter } = await open(cross); const p = await ctx.newPage();
    await p.goto(`${BASE}/website-daily-specials`, { waitUntil: "networkidle", timeout: 60000 }); await scrollAll(p);
    const x = (await anchors(p)).filter((i) => ids.has(i)); ck(`cross-market (${cross}) specials page links none of the batch`, x.length === 0, String(x.length));
    intercepted += counter.intercepted; await ctx.close();
  }
  console.log(`\nanalytics: ${intercepted} tracking requests reached the network layer (answered locally, none sent)`);
  console.log(`${res.filter(Boolean).length}/${res.length} passed`);
  await b.close(); process.exit(res.every(Boolean) ? 0 : 1);
})();
