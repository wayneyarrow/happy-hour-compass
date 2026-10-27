#!/usr/bin/env node
/** Groups a logSupabaseFetches.cjs log: total requests, wall time, duplicates. */
const { readFileSync } = require("node:fs");

const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (!rows.length) {
  console.log("no Supabase requests logged");
  process.exit(0);
}
const t0 = Math.min(...rows.map((r) => r.t));
const end = Math.max(...rows.map((r) => r.t + r.ms));
console.log(`requests: ${rows.length}   wall: ${end - t0} ms   bytes: ${Math.round(rows.reduce((s, r) => s + Math.max(r.bytes, 0), 0) / 1024)} KB`);

const groups = new Map();
for (const r of rows) {
  const k = `${r.method} ${r.path} #${r.q}`;
  const g = groups.get(k) ?? { n: 0, ms: 0, bytes: 0, selectLen: r.selectLen, first: r.t - t0 };
  g.n++;
  g.ms += r.ms;
  g.bytes += Math.max(r.bytes, 0);
  groups.set(k, g);
}
console.log("\ncount  totalMs  avgMs   KB/each  firstAt  query");
for (const [k, g] of [...groups].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(
    `${String(g.n).padStart(5)}  ${String(g.ms).padStart(7)}  ${String(Math.round(g.ms / g.n)).padStart(5)}  ${String(Math.round(g.bytes / g.n / 1024)).padStart(8)}  ${String(g.first).padStart(7)}  ${k} (select ${g.selectLen} chars)`
  );
}

// Sequential depth: requests that started only after an earlier one finished.
const sorted = [...rows].sort((a, b) => a.t - b.t);
let waves = 0;
let waveEnd = -Infinity;
for (const r of sorted) {
  if (r.t >= waveEnd) {
    waves++;
    waveEnd = r.t + r.ms;
  } else waveEnd = Math.max(waveEnd, r.t + r.ms);
}
console.log(`\napprox. sequential waves (each pays at least one DB round trip): ${waves}`);
