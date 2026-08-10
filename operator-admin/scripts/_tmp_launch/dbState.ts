import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // Markets
  const { data: markets } = await supabase.from("markets").select("*").ilike("slug", "%okanagan%");
  console.log("MARKETS:", JSON.stringify(markets, null, 2));

  const marketId = markets?.[0]?.id;

  // Cities in that market
  const { data: cities } = await supabase.from("cities").select("*").eq("market_id", marketId);
  console.log("CITIES:", JSON.stringify(cities, null, 2));

  // Sample existing seed venue full row
  const { data: sample } = await supabase.from("venues").select("*").eq("name", "19 Okanagan Grill + Bar").maybeSingle();
  console.log("SAMPLE VENUE:", JSON.stringify(sample, null, 2));

  // All venues currently in this market (by market_id)
  const { data: allInMarket, count } = await supabase
    .from("venues")
    .select("id,name,slug,city,is_published,source,market_id,neighbourhood_id", { count: "exact" })
    .eq("market_id", marketId)
    .order("name");
  console.log("TOTAL IN MARKET:", count);
  console.log(JSON.stringify(allInMarket, null, 2));
}
main();
