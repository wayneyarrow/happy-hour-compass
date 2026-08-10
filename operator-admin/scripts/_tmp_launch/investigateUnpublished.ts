import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const MARKET_ID = "39083a78-532d-4628-b2cb-d8e6618a15c2"; // central-okanagan

async function main() {
  const { data: venues, error } = await supabase
    .from("venues")
    .select(
      "id,name,slug,is_published,is_verified,source,claimed_at,claimed_by,created_by_operator_id,updated_by_operator_id," +
        "address_line1,city,region,postal_code,phone,website_url,menu_url,establishment_type,market_id,city_id," +
        "hh_times,hh_tagline,hh_food_details,hh_drink_details,hh_times_needs_review,business_hours,payment_types," +
        "cancelled_at,cancellation_reason,cancelled_by_operator_id,review_confirmations,placeholder_image_path,created_at,updated_at"
    )
    .eq("market_id", MARKET_ID)
    .eq("is_published", false)
    .order("name");
  if (error) throw error;

  console.log("Unpublished venue count:", venues?.length);

  for (const v of venues ?? []) {
    console.log("\n================================================================");
    console.log("NAME:", v.name, "| id:", v.id, "| slug:", v.slug);
    console.log(JSON.stringify(v, null, 2));

    const { data: media } = await supabase
      .from("media")
      .select("id,type,url,sort_order,created_at")
      .eq("venue_id", v.id)
      .order("sort_order");
    console.log("MEDIA ROWS:", JSON.stringify(media, null, 2));

    // venue_notes for founder context on why it may be unpublished
    const { data: notes } = await supabase
      .from("venue_notes")
      .select("note,created_by_email,created_at")
      .eq("venue_id", v.id)
      .order("created_at", { ascending: false });
    console.log("VENUE_NOTES:", JSON.stringify(notes, null, 2));
  }
}
main();
