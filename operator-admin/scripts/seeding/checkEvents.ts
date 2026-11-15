/**
 * scripts/seeding/checkEvents.ts — logged-out browser check of a seeded EVENTS batch (analytics blocked).
 * Adapted from checkDraftsHidden.ts / checkPublishedVenues.ts. Keys on the batch's exact slugs and IDs.
 *
 * Usage (from operator-admin/):
 *   npx tsx scripts/seeding/checkEvents.ts --base=https://happyhourcompass.com --batch=<dir>/batch.json --stage=draft|published
 *     [--ids=<file of imported IDs>] [--cross-market=central-okanagan]
 *
 * draft:     every /{market}/{city}/events/{slug} and /website-events/{id} returns 404; no batch venue page, market
 *            /website-events page, market homepage or cross-market events page links a batch event; no slug in the sitemap.
 * published: every event URL returns 200 with its title and og:image = the batch image URL; each venue page links its
 *            events; the market /website-events page links every event; every slug is in the sitemap.
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
const rows: any[] = batch.rows.filter((r: any) => (!only || only.has(r.id)) && (!r.image || r.image.status === "ok"));
const res: boolean[] = []; const ck = (n: string, p: boolean, d = "") => { res.push(p); console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d.slice(0, 500) : ""}`); };
const links = async (p: Page) => p.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
const scrollAll = async (p: Page) => { for (let i = 0; i < 20; i++) { await p.mouse.wheel(0, 2500); await p.waitForTimeout(250); } };

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { data: vs, error } = await db.from("venues").select("id, slug, cities(slug)").in("id", [...new Set(rows.map((r) => r.venue_id))]);
  if (error) throw error;
  const city = new Map((vs as any[]).map((v) => [v.id, v.cities.slug])); const vslug = new Map((vs as any[]).map((v) => [v.id, v.slug]));
  const url = (r: any) => `/${batch.market}/${city.get(r.venue_id)}/events/${r.slug}`;
  const linksTo = (hrefs: string[], r: any) => hrefs.some((h) => h.includes(`/events/${r.slug}`) || h.includes(r.id));
  const b = await chromium.launch(); let intercepted = 0;
  const open = async (mkt: string): Promise<{ ctx: BrowserContext; counter: { intercepted: number } }> => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const counter = await blockAnalytics(ctx);
    await ctx.addCookies([{ name: "hhc_market", value: mkt, url: BASE }]); return { ctx, counter }; };
  const { ctx, counter } = await open(batch.market); const p = await ctx.newPage();
  { const bad: string[] = [];
    for (const r of rows) {
      const a = await ctx.request.get(`${BASE}${url(r)}`, { maxRedirects: 0 });
      const c = await ctx.request.get(`${BASE}/website-events/${r.id}`, { maxRedirects: 0 });
      if (stage === "draft") { if (a.status() !== 404) bad.push(`${url(r)} ${a.status()}`); if (c.status() !== 404) bad.push(`/website-events/${r.id} ${c.status()}`); }
      else {
        if (a.status() !== 200) { bad.push(`${url(r)} ${a.status()}`); continue; }
        const html = await a.text(); const og = (html.match(/property="og:image"\s+content="([^"]+)"/) || [])[1];
        if (!html.includes(r.title.replace(/&/g, "&amp;")) && !html.includes(r.title)) bad.push(`${r.slug}: title missing`);
        if (r.image && og !== r.image.url) bad.push(`${r.slug}: og:image ${og ?? "none"}`);
      } }
    ck(`${rows.length} event URLs ${stage === "draft" ? "return 404 (canonical + /website-events/{id})" : "return 200 with title + og:image"}`, !bad.length, bad.join("; ")); }
  { const bad: string[] = []; const byVenue = new Map<string, any[]>(); for (const r of rows) byVenue.set(r.venue_id, [...(byVenue.get(r.venue_id) ?? []), r]);
    for (const [vid, rs] of byVenue) {
      const resp = await p.goto(`${BASE}/${batch.market}/${city.get(vid)}/${vslug.get(vid)}`, { waitUntil: "networkidle", timeout: 60000 });
      if (resp?.status() !== 200) { bad.push(`${vslug.get(vid)} HTTP ${resp?.status()}`); continue; }
      await scrollAll(p); const h = await links(p);
      for (const r of rs) { const has = linksTo(h, r); if (stage === "draft" ? has : !has) bad.push(`${vslug.get(vid)}: ${r.title} (${r.event_frequency}) ${has ? "linked" : "not linked"}`); } }
    ck(`${byVenue.size} venue pages ${stage === "draft" ? "link none of the batch events" : "link every batch event"}`, !bad.length, bad.join("; ")); }
  { await p.goto(`${BASE}/website-events`, { waitUntil: "networkidle", timeout: 60000 }); await scrollAll(p);
    const h = await links(p); const n = rows.filter((r) => linksTo(h, r)).length; const main = await p.locator("main").innerText();
    const count = (main.match(/\b\d+\s+events?\b/i) || [""])[0];
    ck(`${batch.market} /website-events ${stage === "draft" ? "links none" : "links all"} of the batch`, stage === "draft" ? n === 0 : n === rows.length, `${n} linked; page says "${count}"`);
    await p.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 }); await scrollAll(p); }
  const homeLinks = await links(p); const onHome = rows.filter((r) => linksTo(homeLinks, r)).length;
  if (stage === "draft") ck(`${batch.market} homepage links none of the batch`, onHome === 0, String(onHome)); else console.log(`info  homepage links ${onHome} batch events`);
  { const sm = await (await ctx.request.get(`${BASE}/sitemap.xml`)).text(); const inSm = rows.filter((r) => sm.includes(`/events/${r.slug}<`));
    ck(stage === "draft" ? "no batch event in the sitemap" : "every batch event in the sitemap", stage === "draft" ? !inSm.length : inSm.length === rows.length, `${inSm.length} in sitemap`); }
  intercepted += counter.intercepted; await ctx.close();
  if (stage === "draft") { const o = await open(cross); const q = await o.ctx.newPage();
    await q.goto(`${BASE}/website-events`, { waitUntil: "networkidle", timeout: 60000 }); await scrollAll(q);
    const h = await links(q); const n = rows.filter((r) => linksTo(h, r)).length; ck(`cross-market (${cross}) /website-events links none of the batch`, n === 0, String(n));
    intercepted += o.counter.intercepted; await o.ctx.close(); }
  console.log(`\nanalytics: ${intercepted} tracking requests reached the network layer (answered locally, none sent)`);
  console.log(`${res.filter(Boolean).length}/${res.length} passed`);
  await b.close(); process.exit(res.every(Boolean) ? 0 : 1);
})();
