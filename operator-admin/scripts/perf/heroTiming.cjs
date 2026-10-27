#!/usr/bin/env node
/**
 * Hero-arrival timing for the homepage HTML (no browser, no JavaScript, so
 * nothing on the page runs and no tracking can fire).
 *
 *   node scripts/perf/heroTiming.cjs --base=https://staging.happyhourcompass.com,https://<deployment>.vercel.app \
 *     --runs=10 [--path=/] [--ua=chrome|facebook|googlebot] [--out=scripts/output/perf/<label>/hero.jsonl]
 *
 * Several comma-separated bases are measured alternately (A, B, A, B, ...)
 * so time-of-day and network drift hit both equally. Every request uses a
 * fresh connection and asks for Brotli, like a browser.
 *
 * Per request, milliseconds from sending the request:
 *   headers — response headers received
 *   first   — first body bytes received
 *   hero    — the homepage hero is in the received HTML (its "Discovery
 *             mode" toggle group, which only the hero renders)
 *   end     — the whole document received ("HTML complete" — the same
 *             point as Lighthouse's htmlEnd)
 * plus x-vercel-id (edge::function region), the deployment's
 * x-vercel-deployment-url when present, and decompressed size.
 *
 * With a streamed page, `hero` can arrive well before `end`; without
 * streaming the two are the same.
 */
const https = require("node:https");
const http = require("node:http");
const zlib = require("node:zlib");
const { appendFileSync, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  })
);
const BASES = (args.base || "https://happyhourcompass.com").split(",").map((b) => b.replace(/\/$/, ""));
const RUNS = Number(args.runs || 10);
const PATH = args.path || "/";
const HERO_MARKER = args.marker || 'aria-label="Discovery mode"';
const UAS = {
  chrome:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  googlebot:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};
const UA = UAS[args.ua || "chrome"] || args.ua;

function measure(base) {
  return new Promise((resolve, reject) => {
    const url = new URL(base + PATH);
    const lib = url.protocol === "https:" ? https : http;
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const out = { base, at: new Date().toISOString(), ua: args.ua || "chrome" };
    const req = lib.request(
      url,
      { agent: false, headers: { "user-agent": UA, "accept-encoding": "br", accept: "text/html" } },
      (res) => {
        out.headers = ms();
        out.status = res.statusCode;
        out.vercelId = res.headers["x-vercel-id"] ?? null;
        out.cache = res.headers["x-vercel-cache"] ?? null;
        const decoded = res.headers["content-encoding"] === "br" ? res.pipe(zlib.createBrotliDecompress({ flush: zlib.constants.BROTLI_OPERATION_FLUSH })) : res;
        let html = "";
        res.once("data", () => (out.first = ms()));
        decoded.on("data", (chunk) => {
          html += chunk.toString("utf8");
          if (out.hero === undefined && html.includes(HERO_MARKER)) out.hero = ms();
        });
        decoded.on("end", () => {
          out.end = ms();
          out.bytes = html.length;
          if (out.hero === undefined) out.hero = null;
          resolve(out);
        });
        decoded.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

(async () => {
  const results = [];
  for (let run = 1; run <= RUNS; run++) {
    for (const base of BASES) {
      const r = { run, ...(await measure(base)) };
      results.push(r);
      console.log(
        `${String(run).padStart(2)}  headers ${String(r.headers).padStart(5)}  first ${String(r.first).padStart(5)}  hero ${String(r.hero).padStart(5)}  end ${String(r.end).padStart(5)}  ${r.status} ${r.vercelId ?? ""}  ${base}`
      );
      if (args.out) {
        mkdirSync(dirname(args.out), { recursive: true });
        appendFileSync(args.out, JSON.stringify({ path: PATH, ...r }) + "\n");
      }
    }
  }
  console.log("\nmedians (ms)");
  for (const base of BASES) {
    const rs = results.filter((r) => r.base === base);
    console.log(
      `  headers ${median(rs.map((r) => r.headers))}  first ${median(rs.map((r) => r.first))}  hero ${median(rs.map((r) => r.hero))}  end ${median(rs.map((r) => r.end))}  (n=${rs.length})  ${base}`
    );
  }
})();
