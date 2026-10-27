#!/usr/bin/env node
/**
 * Visual / image-loading check: screenshots each agreed page at mobile and
 * desktop size and verifies that every image visible in the first viewport
 * actually loaded (complete, non-zero natural size). Also reports how many
 * images were deferred (lazy, not yet requested) and CLS.
 *
 *   node scripts/perf/visualCheck.cjs --base=http://localhost:3100 --out=scripts/output/perf/<label>/screens
 */
const { mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");
const { chromium } = require("playwright-core");
const { isTrackingRequest } = require("./trackingBlockList.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  })
);
const BASE = (args.base || "https://happyhourcompass.com").replace(/\/$/, "");
const OUT = args.out || join(__dirname, "../output/perf/screens");
const CHROME = process.env.CHROME_PATH || join(homedir(), ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome");
const PAGES = {
  home: "/",
  hh: "/website-happy-hours",
  ds: "/website-daily-specials",
  v_tsp: "/central-okanagan/kelowna/train-station-pub",
  v_joey: "/central-okanagan/kelowna/joey",
};
const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  for (const [vp, opts] of Object.entries(VIEWPORTS)) {
    for (const [key, path] of Object.entries(PAGES)) {
      const ctx = await browser.newContext(opts);
      await ctx.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      const page = await ctx.newPage();
      await page.route("**/*", (r) => (isTrackingRequest(r.request().url()) ? r.abort() : r.continue()));
      await page.goto(BASE + path, { waitUntil: "load", timeout: 120000 });
      await page.waitForTimeout(3000);
      const r = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const imgs = [...document.images].filter((i) => {
          const b = i.getBoundingClientRect();
          const style = getComputedStyle(i);
          return b.width > 0 && b.height > 0 && style.visibility !== "hidden" && i.offsetParent !== null;
        });
        const inView = imgs.filter((i) => {
          const b = i.getBoundingClientRect();
          return b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw;
        });
        const broken = inView.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc || i.src);
        const all = [...document.images];
        return {
          imagesInFirstViewport: inView.length,
          notLoadedInViewport: broken,
          lazyNotRequested: all.filter((i) => i.loading === "lazy" && !i.complete).length,
          totalImgElements: all.length,
          cls: Number(window.__cls.toFixed(3)),
        };
      });
      await page.screenshot({ path: join(OUT, `${vp}_${key}.png`) });
      console.log(JSON.stringify({ vp, page: key, ...r }));
      await ctx.close();
    }
  }
  await browser.close();
})();
