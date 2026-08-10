import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data } = await supabase
    .from("venues")
    .select("name, hh_food_details, hh_drink_details, hh_times_needs_review, hh_tagline")
    .in("name", ["BTS Cocktail Bar & Kitchen", "Buffalo Rouge Brewing Co.", "Gulfstream", "Curious Cafe", "Chilango Modern Mexican"]);
  console.log(JSON.stringify(data, null, 2));

  const { count } = await supabase.from("venues").select("*", {count:"exact", head:true}).eq("hh_times_needs_review", true).eq("market_id", "39083a78-532d-4628-b2cb-d8e6618a15c2");
  console.log("needs review count in market:", count);
}
main();
