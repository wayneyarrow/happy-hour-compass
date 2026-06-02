/**
 * scripts/exportVenueTaggingMatrix.ts
 *
 * One-time founder utility — exports Kelowna-area published venues into an
 * XLSX spreadsheet for bulk search-tag assignment before Consumer Home V1 launch.
 *
 * Run from the operator-admin directory:
 *   npm run export:tag-matrix
 *
 * Output:
 *   operator-admin/venue-tagging-matrix.xlsx
 *
 * Columns: venue_id | venue_name | city | <one column per tag in catalog>
 *
 * Existing tags are pre-populated as "X". Blank = not tagged.
 * The spreadsheet is structured to serve as future input for a tag-update script.
 *
 * This script is intentionally self-contained. It does not import from the
 * Next.js app's @/lib paths because those modules depend on next/headers and
 * cannot run outside a Next.js request context. The tag catalog below is kept
 * in sync with src/lib/searchTags.ts — update both if the catalog changes.
 */

import * as path from "path";
import * as fs from "fs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CFB = require("cfb") as {
  read: (buf: Buffer, opts: { type: "buffer" }) => {
    FileIndex: Array<{ name: string; content: Buffer | Uint8Array }>;
  };
  write: (cfb: unknown, opts: { type: "buffer"; fileType: "zip" }) => Buffer;
};
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// ── Environment ────────────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    "ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.\n" +
      "       Make sure operator-admin/.env.local is populated."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Tag catalog (mirrors src/lib/searchTags.ts — keep in sync) ────────────────

const SEARCH_TAG_GROUPS = [
  {
    label: "Venue Experience",
    tags: [
      "Patio",
      "Live Music",
      "DJ",
      "Sports Viewing",
      "Trivia Nights",
      "Date Night",
      "Family Friendly",
      "Group Friendly",
      "Dog Friendly",
      "Late Night",
      "Waterfront",
      "Rooftop",
      "Lively",
      "Casual",
      "Bar Seating",
    ],
  },
  {
    label: "Food Highlights",
    tags: [
      "Wings",
      "Burgers",
      "Pizza",
      "Tacos",
      "Seafood",
      "Steak",
      "Appetizers",
      "Small Plates",
      "Vegetarian Friendly",
      "Gluten Friendly",
    ],
  },
  {
    label: "Drink Highlights",
    tags: ["Craft Beer", "Cocktails", "Wine", "Mocktails", "Local Beer"],
  },
];

const ALL_TAGS: string[] = SEARCH_TAG_GROUPS.flatMap((g) => g.tags);

// ── Target cities ──────────────────────────────────────────────────────────────

const TARGET_CITIES = ["Kelowna", "West Kelowna", "Lake Country"];

// ── Freeze pane injection ──────────────────────────────────────────────────────
// xlsx 0.18.x community edition does not expose a freeze-pane API.
// We write the workbook to a buffer, patch the sheetView XML via CFB (xlsx's
// own bundled zip library), then write the modified archive to disk.

function injectFreezePaneAndWrite(wb: XLSX.WorkBook, outputPath: string): void {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const cfb = CFB.read(buf, { type: "buffer" });

  const sheetFile = cfb.FileIndex.find((f) => f.name === "sheet1.xml");
  if (!sheetFile) {
    throw new Error("sheet1.xml not found in workbook — cannot inject freeze pane");
  }

  let xml = Buffer.from(sheetFile.content).toString("utf8");
  xml = xml.replace(
    '<sheetView workbookViewId="0"/>',
    '<sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft"/>' +
      "</sheetView>"
  );
  sheetFile.content = Buffer.from(xml, "utf8");

  const outBuf = CFB.write(cfb, { type: "buffer", fileType: "zip" });
  fs.writeFileSync(outputPath, outBuf);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching published venues in: ${TARGET_CITIES.join(", ")}…\n`);

  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, city, search_tags")
    .eq("is_published", true)
    .in("city", TARGET_CITIES)
    .order("city", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("Supabase error:", error.message);
    process.exit(1);
  }

  if (!venues || venues.length === 0) {
    console.warn(
      "No published venues found for target cities.\n" +
        "Check that is_published = true venues exist in the DB."
    );
    process.exit(0);
  }

  // ── Build worksheet rows ────────────────────────────────────────────────────

  const header = ["venue_id", "venue_name", "city", ...ALL_TAGS];

  const dataRows = venues.map((v) => {
    const existingTags = new Set<string>(
      Array.isArray(v.search_tags) ? (v.search_tags as string[]) : []
    );
    const tagCells = ALL_TAGS.map((tag) => (existingTags.has(tag) ? "X" : ""));
    return [v.id as string, v.name as string, v.city as string, ...tagCells];
  });

  const aoa: (string | number)[][] = [header, ...dataRows];

  // ── Build workbook ──────────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths: UUID | venue name | city | tag columns
  ws["!cols"] = [
    { wch: 38 }, // venue_id (UUID)
    { wch: 34 }, // venue_name
    { wch: 15 }, // city
    ...ALL_TAGS.map((tag) => ({ wch: Math.max(tag.length + 2, 10) })),
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Venue Tags");

  // ── Write file with freeze pane ─────────────────────────────────────────────

  const outputPath = path.resolve(process.cwd(), "venue-tagging-matrix.xlsx");
  injectFreezePaneAndWrite(wb, outputPath);

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.log(`✓ Spreadsheet written to:\n  ${outputPath}\n`);
  console.log(`Summary:`);
  console.log(`  Total venues exported : ${venues.length}`);
  console.log(`  Tag columns           : ${ALL_TAGS.length}`);
  console.log("");

  for (const city of TARGET_CITIES) {
    const count = venues.filter((v) => v.city === city).length;
    console.log(`  ${city.padEnd(16)}: ${count} venue${count !== 1 ? "s" : ""}`);
  }

  const tagged = venues.filter(
    (v) => Array.isArray(v.search_tags) && (v.search_tags as string[]).length > 0
  ).length;
  console.log("");
  console.log(
    `  ${tagged} of ${venues.length} venues already have search tags (pre-populated as X).`
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
