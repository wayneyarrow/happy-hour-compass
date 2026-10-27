#!/usr/bin/env node
/**
 * Summarizes Lighthouse JSON from lighthouse.cjs: one row per run, medians
 * per page+scenario, and a tracking audit (any tracking-looking request that
 * got a real response, i.e. was not blocked).
 *
 *   node scripts/perf/summarize.cjs scripts/output/perf/<label>/lighthouse [--csv=out.csv]
 *
 * Columns: htmlEnd = main document fully received (the meaningful server
 * measure here — see README; Lighthouse's TTFB is header time only).
 * -1 = metric unavailable (e.g. page never reached network idle).
 */
const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, basename } = require("node:path");
const { looksLikeTracking } = require("./trackingBlockList.cjs");

const dir = process.argv[2];
const csvArg = process.argv.find((a) => a.startsWith("--csv="));
if (!dir) {
  console.error("usage: summarize.cjs <lighthouse-dir> [--csv=path]");
  process.exit(1);
}

const num = (a, k) => (a[k] && typeof a[k].numericValue === "number" ? a[k].numericValue : -1);
const median = (xs) => {
  const v = xs.filter((x) => x !== -1).sort((a, b) => a - b);
  if (!v.length) return -1;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const rows = [];
const leaks = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const a = d.audits;
  const reqs = a["network-requests"]?.details?.items ?? [];
  const summary = Object.fromEntries(
    (a["resource-summary"]?.details?.items ?? []).map((i) => [i.resourceType, i])
  );
  const doc = reqs.find((r) => r.resourceType === "Document") ?? {};
  const lcpNode = JSON.stringify(a["lcp-breakdown-insight"]?.details ?? {}).match(/"snippet":"((?:[^"\\]|\\.){0,120})/);
  for (const r of reqs) {
    if (looksLikeTracking(r.url) && (r.statusCode ?? -1) > 0) leaks.push(`${f}: ${r.statusCode} ${r.url.slice(0, 120)}`);
  }
  const [page, scenario] = basename(f, ".json").split(/_(cold|warm)_/);
  const score = d.categories.performance.score;
  rows.push({
    file: basename(f, ".json"),
    group: `${page}_${scenario}`,
    score: score === null ? -1 : Math.round(score * 100),
    htmlEnd: Math.round(doc.networkEndTime ?? -1),
    fcp: Math.round(num(a, "first-contentful-paint")),
    lcp: Math.round(num(a, "largest-contentful-paint")),
    tbt: Math.round(num(a, "total-blocking-time")),
    cls: Number(num(a, "cumulative-layout-shift").toFixed(3)),
    totalKB: Math.round((summary.total?.transferSize ?? 0) / 1024),
    imageKB: Math.round((summary.image?.transferSize ?? 0) / 1024),
    imageReqs: summary.image?.requestCount ?? 0,
    scriptKB: Math.round((summary.script?.transferSize ?? 0) / 1024),
    requests: summary.total?.requestCount ?? 0,
    lcpElement: lcpNode ? lcpNode[1].replace(/\\"/g, '"').slice(0, 90) : "",
    fetchTime: d.fetchTime,
    lighthouse: d.lighthouseVersion,
  });
}

const cols = ["score", "htmlEnd", "fcp", "lcp", "tbt", "cls", "totalKB", "imageKB", "imageReqs", "scriptKB", "requests"];
console.log(["file".padEnd(16), ...cols.map((c) => c.padStart(9))].join(" "));
for (const r of rows) console.log([r.file.padEnd(16), ...cols.map((c) => String(r[c]).padStart(9))].join(" "));

console.log("\nMEDIANS");
const groups = [...new Set(rows.map((r) => r.group))];
for (const g of groups) {
  const rs = rows.filter((r) => r.group === g);
  console.log(
    [g.padEnd(16), ...cols.map((c) => String(Number(median(rs.map((r) => r[c])).toFixed(c === "cls" ? 3 : 0))).padStart(9))].join(" "),
    ` n=${rs.length}  LCP: ${rs[0].lcpElement}`
  );
}

console.log(`\nTRACKING AUDIT: ${leaks.length === 0 ? "no unblocked tracking requests" : `${leaks.length} unblocked`}`);
for (const l of leaks) console.log("  " + l);

if (csvArg) {
  const keys = Object.keys(rows[0] ?? {});
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  writeFileSync(csvArg.slice(6), [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n") + "\n");
  console.log(`\nwrote ${csvArg.slice(6)}`);
}
