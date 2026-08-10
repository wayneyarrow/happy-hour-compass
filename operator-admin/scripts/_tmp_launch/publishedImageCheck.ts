import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const MARKET_ID = "39083a78-532d-4628-b2cb-d8e6618a15c2";

async function main() {
  const { data: published } = await supabase.from("venues").select("id,name,claimed_at").eq("market_id", MARKET_ID).eq("is_published", true);
  console.log("Published venues:", published?.length);

  let withMedia = 0;
  let withoutMedia = 0;
  const withoutMediaNames: string[] = [];
  for (const v of published ?? []) {
    const { count } = await supabase.from("media").select("*", { count: "exact", head: true }).eq("venue_id", v.id).eq("type", "venue_image");
    if ((count ?? 0) > 0) withMedia++;
    else {
      withoutMedia++;
      withoutMediaNames.push(v.name);
    }
  }
  console.log("Published venues WITH >=1 media row:", withMedia);
  console.log("Published venues WITHOUT any media row:", withoutMedia);
  console.log("Names without media:", JSON.stringify(withoutMediaNames, null, 2));
}
main();
