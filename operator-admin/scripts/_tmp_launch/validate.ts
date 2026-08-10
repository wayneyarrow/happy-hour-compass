import * as path from "path";
import * as dotenv from "dotenv";
import * as fs from "fs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MARKET_ID = "39083a78-532d-4628-b2cb-d8e6618a15c2";
const REMOVE_NAMES = [
  "Garden Bistro at Peak Cellars", "Gather Restaurant", "Hugo's Mexican Kitchen",
  "Kettle River Brewing Co.", "La Vela Pizzeria", "Laneway Canteen",
  "Sol Korea Restaurant", "Wings – Rutland",
];

const payload = JSON.parse(
  fs.readFileSync(
    "/tmp/claude-1000/-home-wayneyarrow-happy-hour-compass/60ce922b-6af1-4469-bb1a-6198f185ce4b/scratchpad/hh_update_payload.json",
    "utf-8"
  )
);

async function main() {
  // 1. Total count in market
  const { count: total } = await supabase
    .from("venues")
    .select("*", { count: "exact", head: true })
    .eq("market_id", MARKET_ID);
  console.log("1. Total launch venues in market:", total, "(expected 55)");

  // 2. Removed venues gone
  const { data: stillThere } = await supabase.from("venues").select("id,name").in("name", REMOVE_NAMES);
  console.log("2. Removed venues still present (expect empty):", stillThere);

  // 3. All 53 existing venue_ids present with correct HH data
  const ids = payload.existing.map((e: any) => e.venue_id);
  const { data: existingRows, error } = await supabase
    .from("venues")
    .select("id,name,hh_times,hh_food_details,hh_drink_details,hh_times_needs_review")
    .in("id", ids);
  if (error) throw error;
  console.log("3. Existing rows fetched:", existingRows?.length, "(expected 53)");

  let mismatches = 0;
  for (const p of payload.existing) {
    const row = existingRows?.find((r) => r.id === p.venue_id);
    if (!row) { console.log("MISSING ROW:", p.name); mismatches++; continue; }
    if (row.hh_times !== p.hh_times) {
      console.log("HH_TIMES MISMATCH:", p.name, JSON.stringify(row.hh_times), "vs", JSON.stringify(p.hh_times));
      mismatches++;
    }
    const expectedFood = p.hh_food_details.length > 0 ? JSON.stringify(p.hh_food_details) : null;
    const expectedDrink = p.hh_drink_details.length > 0 ? JSON.stringify(p.hh_drink_details) : null;
    if (row.hh_food_details !== expectedFood) {
      console.log("FOOD MISMATCH:", p.name, row.hh_food_details, "vs", expectedFood);
      mismatches++;
    }
    if (row.hh_drink_details !== expectedDrink) {
      console.log("DRINK MISMATCH:", p.name, row.hh_drink_details, "vs", expectedDrink);
      mismatches++;
    }
  }
  console.log("3b. Mismatches:", mismatches);

  // 8. No launch venue missing HH schedule (non-empty hh_times)
  const { data: allLaunch } = await supabase
    .from("venues")
    .select("id,name,hh_times,is_published")
    .eq("market_id", MARKET_ID);
  const noSchedule = (allLaunch ?? []).filter((v) => !v.hh_times || !v.hh_times.trim());
  console.log("8. Venues with empty hh_times (expect none):", noSchedule);

  // 4/5. New venues present
  const { data: newOnes } = await supabase
    .from("venues")
    .select("*")
    .in("name", ["Erica Jane", "Frankie We Salute You"]);
  console.log("4/5. New venues:", JSON.stringify(newOnes?.map((v) => ({
    name: v.name, id: v.id, address_line1: v.address_line1, city: v.city, region: v.region,
    postal_code: v.postal_code, phone: v.phone, website_url: v.website_url, market_id: v.market_id,
    city_id: v.city_id, is_published: v.is_published, source: v.source, hh_times: v.hh_times,
    hh_food_details: v.hh_food_details, hh_drink_details: v.hh_drink_details,
    establishment_type: v.establishment_type, place_id: v.place_id,
  })), null, 2));

  // 6. No unexpected venue-id churn: verify all 53 existing ids retained (already covered above)
  // 7. spot check a couple of unrelated fields unchanged
  const { data: spot } = await supabase
    .from("venues")
    .select("name,phone,website_url,business_hours,google_rating,is_published,establishment_type")
    .eq("id", "ebfb9747-4b94-4210-b210-2978668130fe")
    .single();
  console.log("7. Spot-check unrelated fields for 19 Okanagan Grill + Bar:", spot);
}
main();
