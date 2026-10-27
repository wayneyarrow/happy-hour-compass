#!/usr/bin/env node
/**
 * Location-permission behaviour checks for the public website.
 *
 *   node scripts/perf/locationChecks.cjs [--base=http://localhost:3100]
 *
 * For each scenario, loads the homepage, Happy Hours and a venue page and
 * records every navigator.geolocation.getCurrentPosition() call made in the
 * first few seconds (expected: none, except a silent read when permission is
 * already granted). Then exercises Near Me and "Nearest First" on Happy
 * Hours and reports what the visitor sees.
 *
 * Scenarios:
 *   prompt        — permission undecided (a real browser would show a prompt
 *                   for any call; Playwright never shows one)
 *   granted       — permission granted, position = downtown Kelowna
 *   denied        — permission denied (Permissions API reports "denied")
 *   unavailable   — permission granted, but no position (POSITION_UNAVAILABLE)
 *   noPermsApi    — permission granted, navigator.permissions removed
 *                   (older iOS Safari / some in-app browsers)
 *   unsupported   — navigator.geolocation removed entirely
 *
 * Tracking requests are blocked via trackingBlockList.cjs.
 */
const { join } = require("node:path");
const { homedir } = require("node:os");
const { chromium } = require("playwright-core");
const { isTrackingRequest, looksLikeTracking } = require("./trackingBlockList.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  })
);
const BASE = (args.base || "https://happyhourcompass.com").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || join(homedir(), ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome");
const KELOWNA = { latitude: 49.8863, longitude: -119.4966 };
const VENUE = "/central-okanagan/kelowna/joey";
const DISTANCE_RE = /\b\d+(\.\d)?\s?km\b|\b\d+\s?m away\b/;

// Installed before any page script: counts getCurrentPosition calls and
// applies the scenario's browser-capability overrides.
function initScript(scenario) {
  return `(() => {
    window.__geoCalls = [];
    window.dataLayer = window.dataLayer || [];
    const scenario = ${JSON.stringify(scenario)};
    if (scenario === "unsupported") {
      try { Object.defineProperty(Navigator.prototype, "geolocation", { get: () => undefined, configurable: true }); } catch {}
      return;
    }
    if (scenario === "noPermsApi") {
      try { Object.defineProperty(Navigator.prototype, "permissions", { get: () => undefined, configurable: true }); } catch {}
    }
    const g = navigator.geolocation;
    const original = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = (ok, err, opts) => {
      window.__geoCalls.push(Math.round(performance.now()));
      if (scenario === "unavailable") {
        setTimeout(() => err && err({ code: 2, message: "Position unavailable", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 50);
        return;
      }
      return original(ok, err, opts);
    };
  })();`;
}

async function newContext(browser, scenario) {
  const granted = ["granted", "unavailable", "noPermsApi"].includes(scenario);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ...(granted ? { geolocation: KELOWNA, permissions: ["geolocation"] } : {}),
  });
  if (scenario === "denied") {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Browser.setPermission", { origin: BASE, permission: { name: "geolocation" }, setting: "denied" });
    await page.close();
  }
  await ctx.addInitScript(initScript(scenario));
  return ctx;
}

const unblocked = [];
async function open(ctx, path) {
  const page = await ctx.newPage();
  page.__track = [];
  await page.route("**/*", (r) => {
    const url = r.request().url();
    if (!isTrackingRequest(url)) return r.continue();
    // Record first-party tracking payloads (never sent anywhere), then block.
    if (/\/api\/track\/website-search/.test(url)) {
      try {
        const b = JSON.parse(r.request().postData() || "{}");
        page.__track.push({ searchTerm: b.searchTerm ?? null, origin: b.origin ?? null, otherFiltersActive: b.otherFiltersActive ?? null, resultCount: b.resultCount ?? null });
      } catch {}
    }
    return r.abort();
  });
  page.on("requestfinished", (req) => { if (looksLikeTracking(req.url())) unblocked.push(req.url()); });
  await page.goto(BASE + path, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(4000);
  return page;
}

async function hhState(page) {
  const track = page.__track.slice();
  const state = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const cards = [...document.querySelectorAll('main a[href^="/central-okanagan/"]')]
      .filter((a) => a.getBoundingClientRect().height > 0);
    const hint = document.querySelector('p[role="status"]')?.textContent?.trim() ?? null;
    return {
      geoCalls: window.__geoCalls.length,
      cardsVisible: cards.length > 0,
      distanceShown: cards.some((a) => re.test(a.textContent || "")),
      firstCard: cards[0]?.getAttribute("href") ?? null,
      hint,
      nearChip: (() => {
        const b = [...document.querySelectorAll("button")].find((x) => /^(Near Me|Locating…)$/.test(x.textContent.trim()));
        return b ? { label: b.textContent.trim(), active: b.className.includes("bg-gray-900") } : null;
      })(),
      sortChip: [...document.querySelectorAll("button")].map((x) => x.textContent.trim()).find((t) => /^Sort(:|$)/.test(t)) ?? null,
      url: location.search,
      gaDiscoveryFiltered: window.dataLayer
        .filter((e) => e && e[0] === "event" && e[1] === "discovery_filtered")
        .map((e) => e[2]),
    };
  }, DISTANCE_RE.source);
  return { ...state, searchEvents: track };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const scenarios = (args.scenarios || "prompt,granted,denied,unavailable,noPermsApi,unsupported").split(",");
  for (const scenario of scenarios) {
    const ctx = await newContext(browser, scenario);
    const out = { scenario };

    // 1. Page loads — automatic calls only.
    for (const [key, path] of [["home", "/"], ["hhLoad", "/website-happy-hours"], ["venue", VENUE]]) {
      const page = await open(ctx, path);
      if (key === "hhLoad") out.hhLoad = await hhState(page);
      else {
        out[key] = await page.evaluate((reSrc) => ({
          geoCalls: window.__geoCalls.length,
          distanceShown: new RegExp(reSrc).test(document.querySelector("main")?.textContent || ""),
          cookies: document.cookie.includes("hhc_market"),
        }), DISTANCE_RE.source);
      }
      await page.close();
    }

    // 2. Explicit Near Me on Happy Hours.
    let page = await open(ctx, "/website-happy-hours");
    await page.getByRole("button", { name: "Near Me" }).first().click();
    await page.waitForTimeout(2500);
    out.afterNearMe = await hhState(page);
    await page.close();

    // 3. Explicit "Nearest First" sort choice on Happy Hours (fresh page).
    page = await open(ctx, "/website-happy-hours");
    await page.getByRole("button", { name: /^Sort(:|$)/ }).first().click();
    await page.getByRole("button", { name: /Nearest First/ }).filter({ visible: true }).first().click();
    await page.waitForTimeout(2500);
    out.afterNearest = await hhState(page);
    await page.close();

    // 4. Near Me, then a typed search: the website_search_events payload's
    //    otherFiltersActive must reflect whether Near Me actually applied.
    page = await open(ctx, "/website-happy-hours");
    await page.getByRole("button", { name: "Near Me" }).first().click();
    await page.waitForTimeout(2500);
    const input = page.getByPlaceholder(/Search by name/).first();
    await input.click();
    await input.pressSequentially("bar", { delay: 120 });
    await page.waitForTimeout(2500);
    out.nearMeThenSearch = await hhState(page);
    await page.close();

    // 5. Shared link with ?near=1 (no tap).
    page = await open(ctx, "/website-happy-hours?near=1");
    out.nearDeepLink = await hhState(page);
    await page.close();

    console.log(JSON.stringify(out));
    await ctx.close();
  }
  await browser.close();
  console.log(unblocked.length
    ? `TRACKING AUDIT: ${unblocked.length} unblocked\n  ` + unblocked.join("\n  ")
    : "TRACKING AUDIT: no unblocked tracking requests");
})();
