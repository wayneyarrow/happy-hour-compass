#!/usr/bin/env node
/**
 * Everyday browsing journeys (mobile emulation, 390x844).
 *
 *   node scripts/perf/journeys.cjs --profile=none|fast4g --runs=3 [--base=https://happyhourcompass.com] [--out=file.jsonl]
 *
 * Profiles: none = unthrottled; fast4g = 9 Mbps down / 1.5 Mbps up, 165 ms
 * latency, 4x CPU slowdown. Fresh browser context per run, location not
 * granted (Playwright default). Every timer starts at the tap/click; the end
 * point of each journey is documented in docs/performance/README.md.
 * Tracking requests are blocked via trackingBlockList.cjs; any tracking-
 * looking request that still went out is reported at the end.
 */
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { chromium } = require('playwright-core');
const { isTrackingRequest, looksLikeTracking } = require('./trackingBlockList.cjs');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const BASE = (args.base || 'https://happyhourcompass.com').replace(/\/$/, '');
const PROFILE = args.profile || 'none'; const RUNS = +(args.runs || 3);
const OUT = args.out || null;
const CHROME = process.env.CHROME_PATH || join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
const unblocked = [];
const VENUE_RE = /^\/central-okanagan\/[^/]+\/[^/#?]+(#.*)?$/;
const now = () => Date.now();

async function setup(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36' });
  const page = await ctx.newPage();
  await page.route('**/*', r => isTrackingRequest(r.request().url()) ? r.abort() : r.continue());
  page.on('requestfinished', (req) => { if (looksLikeTracking(req.url())) unblocked.push(req.url()); });
  const cdp = await ctx.newCDPSession(page);
  if (PROFILE === 'fast4g') {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 165, downloadThroughput: 9e6/8, uploadThroughput: 1.5e6/8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const rsc = [];
  page.on('requestfinished', async req => {
    const u = req.url(); const h = req.headers();
    if (u.includes('_rsc=') || h['rsc'] === '1') {
      const t = req.timing(); let size = null; try { size = (await req.sizes()).responseBodySize; } catch {}
      rsc.push({ at: now(), path: new URL(u).pathname, prefetch: !!h['next-router-prefetch'], ms: Math.round(t.responseEnd), size });
    }
  });
  return { ctx, page, rsc };
}
async function visibleVenueLink(page, scopeSel) {
  const links = page.locator(`${scopeSel} a[href^="/central-okanagan/"]`);
  const n = await links.count();
  for (let i = 0; i < n; i++) { const l = links.nth(i); const href = await l.getAttribute('href');
    if (VENUE_RE.test(href) && !href.includes('/guides/') && !href.includes('/collections/') && await l.isVisible()) return { l, href }; }
  return null;
}
async function waitCards(page, t0, timeout = 60000) {
  await page.waitForFunction(() => [...document.querySelectorAll('main a[href^="/central-okanagan/"]')].some(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && a.querySelector('img,h3,h2,p'); }), null, { timeout });
  return now() - t0;
}
const result = [];
function rec(j, run, o) {
  const row = { profile: PROFILE, base: BASE, at: new Date().toISOString(), j, run, ...o };
  result.push(row); console.log(JSON.stringify(row)); if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n');
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  for (let run = 1; run <= RUNS; run++) {
    const { ctx, page, rsc } = await setup(browser);
    try {
      // J1 Home -> Happy Hours (hero/primary link)
      await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 }); await page.waitForTimeout(3000);
      await page.evaluate(() => { window.__mark = 1; });
      let link = page.locator('main a[href="/website-happy-hours"]').first();
      if (!(await link.isVisible())) link = page.locator('a[href="/website-happy-hours"]').first();
      rsc.length = 0; let t0 = now();
      await link.click();
      await page.waitForURL('**/website-happy-hours', { timeout: 60000 }); const tUrl = now() - t0;
      const tCards = await waitCards(page, t0);
      rec('J1_home_to_hh', run, { urlChange: tUrl, contentVisible: tCards, softNav: await page.evaluate(() => window.__mark === 1), rsc: rsc.filter(r => r.path.includes('happy')) });
      await page.waitForTimeout(3000);

      // J4 filter: On Now toggle on, then off
      for (const phase of ['on', 'off']) {
        const before = await page.evaluate(() => [...document.querySelectorAll('main a[href^="/central-okanagan/"]')].map(a => a.getAttribute('href')).join('|'));
        const chip = page.getByRole('button', { name: 'On Now' }).first();
        t0 = now(); await chip.click();
        let changed = true;
        try { await page.waitForFunction(b => [...document.querySelectorAll('main a[href^="/central-okanagan/"]')].map(a => a.getAttribute('href')).join('|') !== b, before, { timeout: 15000 }); } catch { changed = false; }
        const dt = now() - t0;
        // next paint after change
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
        rec('J4_filter_onnow_' + phase, run, { resultsChanged: changed, updated: dt, paintAfter: now() - t0, url: new URL(page.url()).search });
        await page.waitForTimeout(1500);
      }

      // J2 HH -> venue
      const v = await visibleVenueLink(page, 'main');
      await page.evaluate(() => { window.__mark = 1; }); rsc.length = 0;
      const pre = rsc.length;
      t0 = now(); await v.l.click();
      await page.waitForURL(u => VENUE_RE.test(new URL(u).pathname), { timeout: 60000 }); const tU2 = now() - t0;
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 60000 });
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.trim().length > 0);
      rec('J2_hh_to_venue', run, { href: v.href, urlChange: tU2, h1Visible: now() - t0, softNav: await page.evaluate(() => window.__mark === 1), rsc: rsc.slice() });
      await page.waitForTimeout(3000);

      // J3 venue -> back to results
      rsc.length = 0; t0 = now(); await page.goBack();
      await page.waitForURL('**/website-happy-hours**', { timeout: 60000 }); const tU3 = now() - t0;
      const tC3 = await waitCards(page, t0);
      rec('J3_venue_back_to_hh', run, { urlChange: tU3, contentVisible: tC3, softNav: await page.evaluate(() => window.__mark === 1), rsc: rsc.slice() });

      // J5 Daily Specials (full load) -> venue
      t0 = now(); await page.goto(BASE + '/website-daily-specials', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForLoadState('load', { timeout: 120000 }).catch(() => {});
      const dsLoad = now() - t0; await page.waitForTimeout(3000);
      const d = await visibleVenueLink(page, 'main');
      await page.evaluate(() => { window.__mark = 1; }); rsc.length = 0;
      t0 = now(); await d.l.click();
      await page.waitForURL(u => VENUE_RE.test(new URL(u).pathname), { timeout: 60000 }); const tU5 = now() - t0;
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 60000 });
      rec('J5_ds_to_venue', run, { dsFullLoad: dsLoad, href: d.href, urlChange: tU5, h1Visible: now() - t0, softNav: await page.evaluate(() => window.__mark === 1), rsc: rsc.slice() });
    } catch (e) { console.log('ERR run', run, e.message.split('\n')[0]); }
    await ctx.close();
  }
  await browser.close();
  console.log(unblocked.length
    ? `TRACKING AUDIT: ${unblocked.length} unblocked\n  ` + unblocked.join('\n  ')
    : 'TRACKING AUDIT: no unblocked tracking requests');
})();
