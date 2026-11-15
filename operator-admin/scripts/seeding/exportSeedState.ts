/**
 * scripts/seeding/exportSeedState.ts — READ-ONLY export of the state a new seed batch is built against.
 *
 * Usage (from operator-admin/):
 *   npx tsx scripts/seeding/exportSeedState.ts --market=<market-slug> --out=<work dir> \
 *     [--review-dir=../docs/operations/<market>]
 *
 * Writes to <work dir> (keep it outside the repo, e.g. ~/hhc-work/<batch>/):
 *   existing.json     every venue's name/slug/Place ID + this market's stock photos and the ZIPs using each
 *                     (input for buildSeedBatch.py: dedupe + photo choice)
 *   used_photos.txt   every placeholder image used by any venue in any market
 *   exclusions.md     "LIVE" (this market's venues) + "PREVIOUSLY HELD" (holds in every *-review.csv under
 *                     --review-dir) — append to the screening brief so screeners skip them
 * Only SELECTs venues and markets.
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readSeedCsv } from "../../src/lib/seeding/marketVenueImport";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const fail = (msg: string): never => { console.error(`ERROR: ${msg}`); process.exit(1); };

const market = arg("market"), out = arg("out"), reviewDir = arg("review-dir");
if (!market || !out) fail("required: --market=<slug> --out=<work dir>");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
const db = createClient(URL_!, KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

function reviewCsvs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? reviewCsvs(path.join(dir, e.name)) : e.name.endsWith("-review.csv") ? [path.join(dir, e.name)] : []);
}

(async () => {
  const { data: mk, error: mErr } = await db.from("markets").select("id, slug").eq("slug", market!).single();
  if (mErr || !mk) fail(`market ${market} not found`);
  const { data: venues, error } = await db.from("venues").select("name, slug, place_id, placeholder_image_path, postal_code, market_id, is_published").range(0, 9999);
  if (error) fail(`could not read venues: ${error.message}`);
  const rows = venues ?? [];
  if (rows.length >= 10000) fail("venues exceeds 10,000 rows — add pagination");
  const inMarket = rows.filter((v) => v.market_id === mk!.id);
  const photoZips: Record<string, string[]> = {};
  for (const v of inMarket) if (v.placeholder_image_path) (photoZips[v.placeholder_image_path] ??= []).push(v.postal_code ?? "");

  fs.mkdirSync(path.resolve(out!), { recursive: true });
  fs.writeFileSync(path.join(out!, "existing.json"), JSON.stringify({
    names: rows.map((v) => v.name), slugs: rows.map((v) => v.slug), place_ids: rows.map((v) => v.place_id).filter(Boolean),
    market_photos: Object.keys(photoZips).sort(), market_photo_zips: photoZips,
  }));
  fs.writeFileSync(path.join(out!, "used_photos.txt"), [...new Set(rows.map((v) => v.placeholder_image_path).filter(Boolean))].sort().join("\n") + "\n");

  const held: string[] = [];
  if (reviewDir) {
    for (const f of reviewCsvs(path.resolve(reviewDir))) {
      for (const r of readSeedCsv(fs.readFileSync(f, "utf8")).rows) {
        const status = r.values.batch_status ?? "";
        if (status && status !== "IN BATCH" && r.values.name && !inMarket.some((v) => v.name === r.values.name)) held.push(r.values.name);
      }
    }
  }
  const live = inMarket.map((v) => v.name).sort();
  fs.writeFileSync(path.join(out!, "exclusions.md"),
    `LIVE OR DRAFT IN ${market} (${live.length}): ${live.join(" | ")}\n\nPREVIOUSLY HELD (${[...new Set(held)].length}, do not re-screen): ${[...new Set(held)].join(" | ")}\n`);
  console.log(`Wrote ${out}/existing.json (${rows.length} venues, ${Object.keys(photoZips).length} photos in ${market}), used_photos.txt, exclusions.md (${live.length} in market, ${[...new Set(held)].length} held)`);
})();
