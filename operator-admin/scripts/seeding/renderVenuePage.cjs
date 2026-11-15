// scripts/seeding/renderVenuePage.cjs — Render a venue page for screening (read-only browser GETs; output goes to a work folder outside the repo).
// Render a JS-heavy page: saves text.txt (innerText), tc.txt (full textContent incl. hidden tabs),
// slice-N.png screenshots (1280x1000 each, up to 12), and prints a JSON summary.
// Usage: node operator-admin/scripts/seeding/renderVenuePage.cjs "<url>" <outDir>
const { chromium } = require("playwright");
const fs = require("fs");
const [url, outDir] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const t0 = Date.now();
  let status = null;
  try { const r = await p.goto(url, { waitUntil: "networkidle", timeout: 60000 }); status = r && r.status(); }
  catch (e) { try { const r = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); status = r && r.status(); await p.waitForTimeout(4000); } catch (e2) { status = "ERR " + e2.message.slice(0, 80); } }
  for (let y = 0; y < 12; y++) { await p.mouse.wheel(0, 1200); await p.waitForTimeout(250); }
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500);
  const text = await p.evaluate(() => document.body ? document.body.innerText : "");
  const tc = await p.evaluate(() => document.body ? document.body.textContent.replace(/\s+/g, " ") : "");
  fs.writeFileSync(`${outDir}/text.txt`, text); fs.writeFileSync(`${outDir}/tc.txt`, tc);
  const h = await p.evaluate(() => document.body ? document.body.scrollHeight : 0);
  let n = 0;
  for (let y = 0; y < Math.min(h, 12000) && n < 12; y += 1000, n++) await p.screenshot({ path: `${outDir}/slice-${n}.png`, clip: { x: 0, y, width: 1280, height: 1000 }, fullPage: true }).catch(() => {});
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const hhLines = lines.filter((l) => /happy|hh\b|\$\s?\d|\d\s?(am|pm)\b|closed|hours/i.test(l)).slice(0, 60);
  const links = await p.$$eval("a[href]", (as) => as.map((a) => [a.innerText.trim().slice(0, 40), a.href]).filter(([t, h]) => /happy|menu|hour|special|\.pdf|drink|food|bar/i.test(t + h)).slice(0, 40));
  const bigImages = await p.$$eval("img", (is) => is.filter((i) => i.naturalWidth >= 600).map((i) => ({ src: i.currentSrc || i.src, alt: i.alt, w: i.naturalWidth })).slice(0, 20));
  console.log(JSON.stringify({ status, ms: Date.now() - t0, height: h, slices: n, textChars: text.length, hhLines, links, bigImages }, null, 1));
  await b.close();
})();
