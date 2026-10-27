#!/usr/bin/env node
/**
 * Lighthouse page-load baseline (mobile, DevTools throttling, cold + warm).
 *
 *   node scripts/perf/lighthouse.cjs --base=https://happyhourcompass.com --runs=3 --label=prod-2026-10-27
 *   node scripts/perf/lighthouse.cjs --base=http://localhost:3100 --runs=3 --label=local-after
 *
 * Each run launches a fresh headless Chrome profile, runs Lighthouse once
 * with storage reset (cold) and once more in the same browser with
 * --disable-storage-reset (warm: HTTP cache kept), then closes it.
 *
 * Why DevTools throttling, not Lighthouse's default "simulate": Vercel sends
 * response headers ~30 ms after the request but the HTML body only once the
 * whole page has rendered (~2.8 s on the homepage). Simulated mode treats the
 * header time as the server time and under-reports FCP by ~3 s. See
 * docs/performance/README.md.
 *
 * Every tracking/analytics request in trackingBlockList.cjs is blocked; the
 * summary step flags any that still got through.
 *
 * Env: CHROME_PATH (default: Playwright's Chrome for Testing build), LH_VERSION.
 */
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, rmSync } = require("node:fs");
const { tmpdir, homedir } = require("node:os");
const { join } = require("node:path");
const { LIGHTHOUSE_PATTERNS } = require("./trackingBlockList.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  })
);
const BASE = (args.base || "https://happyhourcompass.com").replace(/\/$/, "");
const RUNS = Number(args.runs || 3);
const LABEL = args.label || `run-${new Date().toISOString().slice(0, 10)}`;
const OUT = args.out || join(__dirname, "../output/perf", LABEL, "lighthouse");
const LH_VERSION = process.env.LH_VERSION || "13.5.0";
const CHROME =
  process.env.CHROME_PATH ||
  join(homedir(), ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome");
const PORT = 9333;

// The agreed page set (see docs/performance/README.md for why these venues).
const PAGES = {
  home: "/",
  hh: "/website-happy-hours",
  ds: "/website-daily-specials",
  v_tsp: "/central-okanagan/kelowna/train-station-pub",
  v_joey: "/central-okanagan/kelowna/joey",
};
const only = args.pages ? args.pages.split(",") : Object.keys(PAGES);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lighthouse(url, outPath, warm) {
  const flags = [
    "-y",
    `lighthouse@${LH_VERSION}`,
    url,
    `--port=${PORT}`,
    "--only-categories=performance",
    "--throttling-method=devtools",
    "--max-wait-for-load=60000",
    "--output=json",
    `--output-path=${outPath}`,
    "--quiet",
    ...LIGHTHOUSE_PATTERNS.map((p) => `--blocked-url-patterns=${p}`),
  ];
  if (warm) flags.push("--disable-storage-reset");
  const r = spawnSync("npx", flags, { stdio: "ignore" });
  if (r.status !== 0) console.warn(`  lighthouse exited ${r.status} for ${url}`);
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  console.log(`Lighthouse ${LH_VERSION} → ${BASE} (${RUNS} runs) → ${OUT}`);
  for (const key of only) {
    const url = BASE + PAGES[key];
    for (let i = 1; i <= RUNS; i++) {
      const profile = mkdtempSync(join(tmpdir(), "hhc-lh-"));
      const chrome = spawn(
        CHROME,
        ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"],
        { stdio: "ignore" }
      );
      await sleep(2000);
      lighthouse(url, join(OUT, `${key}_cold_${i}.json`), false);
      lighthouse(url, join(OUT, `${key}_warm_${i}.json`), true);
      chrome.kill();
      await sleep(500);
      rmSync(profile, { recursive: true, force: true });
      console.log(`${key} run ${i} done ${new Date().toISOString().slice(11, 19)}Z`);
    }
  }
})();
