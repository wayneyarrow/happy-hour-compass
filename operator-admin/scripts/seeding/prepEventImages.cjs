// scripts/seeding/prepEventImages.cjs — prepare event stock photos for a content batch (LOCAL ONLY — no uploads).
// Playbook: docs/operations/MARKET_CONTENT_SEEDING_PLAYBOOK.md, "Event images".
//
// Usage (from operator-admin/; sharp ships with Next.js):
//   node scripts/seeding/prepEventImages.cjs --src=<downloads dir> --csv=<download csv> --out=<work dir> [--library=public/images] [--library=<dir> ...]
//
// <download csv> columns (one row per slot, written by the image-sourcing session):
//   slot_id, filename, unsplash_id, photo_page_url, photographer, photographer_profile, licence, attribution_required,
//   suggested_credit, match, review_note
// slot_id = <TYPE>-<n> with TYPE in TRIVIA | DJ | LIVE | KARAOKE | DRAG | BINGO | GAMES | <any other UPPERCASE word>.
//
// Writes to <work dir>:
//   prepared/event-pic-<type>-<n>.jpg   progressive JPEG, longest side 1600 px, 4:2:0, metadata stripped
//   crops/<slot>-card.jpg (360×200), crops/<slot>-mobile.jpg (340×200), crops/<slot>-hero.jpg (800×260) — centre crops,
//       exactly what object-cover shows on event cards and the event detail hero
//   sheet-cards.jpg                     contact sheet of the card crops for the visual review
//   prep-report.json                    per-slot hashes, sizes, source/licence fields, near-duplicate findings (input to `build --images`)
//   sources-draft.csv                   the stock-photo source record with decision/reason left blank for the reviewer
// Exit 1 when a CSV row has no file, a file has no CSV row, or a filename doesn't match its slot.
const sharp = require(require.resolve("sharp", { paths: [process.cwd()] }));
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const args = process.argv.slice(2);
const one = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const many = (n) => args.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3));
const src = one("src"), csvPath = one("csv"), out = one("out"), libs = many("library");
if (!src || !csvPath || !out) { console.error("required: --src=<dir> --csv=<download csv> --out=<work dir>"); process.exit(1); }
const parseCsv = (t) => { const rows = []; let r = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { r.push(f); f = ""; } else if (c === "\n") { r.push(f); rows.push(r); r = []; f = ""; } else if (c !== "\r") f += c; }
  if (f || r.length) { r.push(f); rows.push(r); } const [h, ...d] = rows; return d.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i] ?? ""]))); };
const cell = (x) => { const s = x == null ? "" : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
async function dhash(buf) { const px = await sharp(buf).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer(); let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n); return h; }
const ham = (a, b) => { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
const TYPE = { LIVE: "live-music" };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
(async () => {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  for (const d of ["prepared", "crops"]) fs.mkdirSync(path.join(out, d), { recursive: true });
  const problems = [];
  const files = fs.readdirSync(src).filter((f) => /\.jpe?g$/i.test(f));
  for (const f of files) if (!rows.some((r) => r.filename === f)) problems.push(`file not in CSV: ${f}`);
  const lib = [];
  for (const d of libs) for (const f of fs.readdirSync(d, { recursive: true })) { const p = path.join(d, String(f)); if (/\.(jpe?g|png)$/i.test(p) && fs.statSync(p).isFile()) { try { lib.push([p, await dhash(fs.readFileSync(p))]); } catch {} } }
  const res = [];
  for (const r of rows) {
    const p = path.join(src, r.filename);
    if (!/^[A-Z]+-\d+$/.test(r.slot_id)) { problems.push(`bad slot_id ${r.slot_id}`); continue; }
    if (!fs.existsSync(p)) { problems.push(`missing file for ${r.slot_id}: ${r.filename}`); continue; }
    if (r.filename.replace(/\.jpe?g$/i, "") !== r.slot_id) problems.push(`filename/slot mismatch ${r.slot_id} vs ${r.filename}`);
    const buf = fs.readFileSync(p); const meta = await sharp(buf).metadata();
    const [prefix, n] = r.slot_id.split("-"); const name = `event-pic-${TYPE[prefix] ?? prefix.toLowerCase()}-${n}.jpg`;
    const prepared = await sharp(buf).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, chromaSubsampling: "4:2:0", mozjpeg: true }).toBuffer();
    fs.writeFileSync(path.join(out, "prepared", name), prepared);
    const pm = await sharp(prepared).metadata();
    for (const [k, w, h] of [["card", 360, 200], ["mobile", 340, 200], ["hero", 800, 260]])
      await sharp(prepared).resize(w, h, { fit: "cover", position: "centre" }).jpeg({ quality: 82 }).toFile(path.join(out, "crops", `${r.slot_id}-${k}.jpg`));
    const dh = await dhash(prepared);
    res.push({ slot: r.slot_id, originalFile: r.filename, srcSha256: sha(buf), srcW: meta.width, srcH: meta.height, preparedName: name, preparedBytes: prepared.length,
      preparedSha256: sha(prepared), w: pm.width, h: pm.height, progressive: pm.isProgressive, chroma: pm.chromaSubsampling, preparedHasExif: !!pm.exif, dhash: dh.toString(16),
      unsplash_id: r.unsplash_id, photo_page_url: r.photo_page_url, photographer: r.photographer, photographer_profile: r.photographer_profile, licence: r.licence,
      attribution_required: r.attribution_required, suggested_credit: r.suggested_credit, match: r.match, review_note: r.review_note,
      libNear: lib.filter(([, h]) => ham(h, dh) <= 10).map(([lp, h]) => `${lp} (d=${ham(h, dh)})`) });
  }
  for (let i = 0; i < res.length; i++) for (let j = i + 1; j < res.length; j++) { const d = ham(BigInt("0x" + res[i].dhash), BigInt("0x" + res[j].dhash)); if (d <= 10) problems.push(`near-duplicate ${res[i].slot} ~ ${res[j].slot} (d=${d})`); }
  for (const r of res) if (r.libNear.length) problems.push(`${r.slot} near library image: ${r.libNear.join("; ")}`);
  fs.writeFileSync(path.join(out, "prep-report.json"), JSON.stringify({ problems, images: res }, null, 1));
  const cols = ["slot_id", "unsplash_id", "photographer", "photographer_profile", "photo_page_url", "licence", "attribution_required", "suggested_credit", "original_file", "original_sha256",
    "original_px", "decision", "prepared_file", "prepared_sha256", "prepared_px", "prepared_kb", "event_rows", "reason", "download_match_note", "downloaded"];
  fs.writeFileSync(path.join(out, "sources-draft.csv"), [cols.join(","), ...res.map((i) => [i.slot, i.unsplash_id, i.photographer, i.photographer_profile, i.photo_page_url, i.licence,
    i.attribution_required, i.suggested_credit, i.originalFile, i.srcSha256, `${i.srcW}x${i.srcH}`, "", i.preparedName, i.preparedSha256, `${i.w}x${i.h}`, Math.round(i.preparedBytes / 1024), "", "",
    i.review_note, new Date().toISOString().slice(0, 10)].map(cell).join(","))].join("\n") + "\n");
  const tiles = [];
  for (let i = 0; i < res.length; i++) { const r = res[i];
    const lbl = Buffer.from(`<svg width="360" height="22"><rect width="360" height="22" fill="black"/><text x="5" y="16" fill="white" font-size="14">${r.slot}</text></svg>`);
    tiles.push({ input: path.join(out, "crops", `${r.slot}-card.jpg`), left: (i % 5) * 365, top: Math.floor(i / 5) * 227 + 22 }, { input: lbl, left: (i % 5) * 365, top: Math.floor(i / 5) * 227 }); }
  if (res.length) await sharp({ create: { width: 5 * 365, height: Math.ceil(res.length / 5) * 227, channels: 3, background: "#fff" } }).composite(tiles).jpeg({ quality: 80 }).toFile(path.join(out, "sheet-cards.jpg"));
  for (const r of res) console.log(`${r.slot.padEnd(10)} ${r.srcW}x${r.srcH} -> ${r.w}x${r.h} ${(r.preparedBytes / 1024).toFixed(0)}KB prog=${r.progressive} ${r.chroma} exif=${r.preparedHasExif} ${r.preparedName}`);
  console.log(JSON.stringify({ prepared: res.length, csvRows: rows.length, files: files.length, problems }, null, 1));
  if (problems.some((p) => /missing|not in CSV|mismatch|bad slot/.test(p))) process.exit(1);
})();
