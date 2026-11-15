// scripts/seeding/renderMenuPdf.cjs — Render a PDF menu for screening (read-only browser GETs; output goes to a work folder outside the repo).
// Render a PDF menu page-by-page with Firefox's built-in pdf.js; saves page-N.png and text.txt.
// Usage: node operator-admin/scripts/seeding/renderMenuPdf.cjs "<pdf url or local path>" <outDir>
const { firefox } = require("playwright");
const fs = require("fs");
const [src, outDir] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await firefox.launch({ firefoxUserPrefs: { "pdfjs.disabled": false, "browser.download.open_pdf_attachments_inline": true } });
  const p = await b.newPage({ viewport: { width: 1200, height: 1550 } });
  const url = /^https?:/.test(src) ? src : "file://" + require("path").resolve(src);
  await p.goto(url, { waitUntil: "load", timeout: 90000 }).catch((e) => console.log("goto:", e.message.slice(0, 120)));
  await p.waitForTimeout(4000);
  const pages = await p.evaluate(() => (window.PDFViewerApplication && window.PDFViewerApplication.pagesCount) || 0).catch(() => 0);
  console.log("pages:", pages);
  let text = "";
  for (let i = 1; i <= Math.min(pages || 1, 20); i++) {
    await p.evaluate((n) => { if (window.PDFViewerApplication) window.PDFViewerApplication.page = n; }, i).catch(() => {});
    await p.waitForTimeout(1800);
    const el = await p.$(`.page[data-page-number="${i}"]`);
    if (el) await el.screenshot({ path: `${outDir}/page-${i}.png` }); else await p.screenshot({ path: `${outDir}/page-${i}.png` });
    const t = await p.evaluate((n) => { const pg = document.querySelector(`.page[data-page-number="${n}"] .textLayer`); return pg ? pg.innerText : ""; }, i).catch(() => "");
    text += `\n=== page ${i} ===\n` + t;
  }
  fs.writeFileSync(`${outDir}/text.txt`, text);
  console.log("saved", Math.min(pages || 1, 20), "page(s) to", outDir);
  await b.close();
})();
