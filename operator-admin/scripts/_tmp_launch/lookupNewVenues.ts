import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const PLACES_API_BASE = "https://places.googleapis.com/v1";

const PLACE_FIELDS = [
  "id",
  "displayName",
  "businessStatus",
  "regularOpeningHours",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "formattedAddress",
  "addressComponents",
  "location",
  "primaryType",
  "types",
  "googleMapsUri",
] as const;

const TEXT_SEARCH_FIELD_MASK = PLACE_FIELDS.map((f) => `places.${f}`).join(",");

async function textSearch(query: string) {
  const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("ERROR", res.status, JSON.stringify(json, null, 2));
    return null;
  }
  return json;
}

async function main() {
  for (const q of [
    "Erica Jane, Kelowna, BC",
    "Erica Jane restaurant Kelowna",
    "Frankie We Salute You, Kelowna, BC",
  ]) {
    console.log("\n\n=== QUERY:", q, "===");
    const result = await textSearch(q);
    console.log(JSON.stringify(result, null, 2));
    await new Promise((r) => setTimeout(r, 250));
  }
}

main();
