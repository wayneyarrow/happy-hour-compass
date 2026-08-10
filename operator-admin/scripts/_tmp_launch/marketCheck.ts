import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
async function main() {
  const { data: markets } = await supabase.from("markets").select("id,slug,name,status");
  console.log("MARKETS:", JSON.stringify(markets, null, 2));
  for (const m of markets ?? []) {
    const { count } = await supabase.from("venues").select("*", { count: "exact", head: true }).eq("market_id", m.id);
    const { count: pubCount } = await supabase.from("venues").select("*", { count: "exact", head: true }).eq("market_id", m.id).eq("is_published", true);
    console.log(m.slug, "total:", count, "published:", pubCount);
  }
  const { count: noMarket } = await supabase.from("venues").select("*", { count: "exact", head: true }).is("market_id", null);
  console.log("no market_id:", noMarket);

  // Also check unpublished breakdown reasons
  const { count: unpub } = await supabase.from("venues").select("*", { count: "exact", head: true }).eq("is_published", false);
  console.log("unpublished total:", unpub);
}
main();
