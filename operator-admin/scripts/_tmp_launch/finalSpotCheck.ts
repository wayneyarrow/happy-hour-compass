import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
async function main() {
  const { data } = await supabase
    .from("venues")
    .select("name,is_published,establishment_type,hh_times,hh_food_details,hh_drink_details,placeholder_image_path,claimed_by,claimed_at")
    .in("name", ["Skinny Dukes","BTS Cocktail Bar & Kitchen","Buffalo Rouge Brewing Co.","Chilango Modern Mexican","Fancy’s Cold Cuts & Cocktails","Room 272 Bar + Bites","The Office Brewery","Turtle Jack's West Kelowna"]);
  console.log(JSON.stringify(data, null, 2));
}
main();
