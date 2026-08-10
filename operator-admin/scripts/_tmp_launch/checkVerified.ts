import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
async function main() {
  const { data } = await supabase.from("venues").select("is_verified").eq("market_id", "39083a78-532d-4628-b2cb-d8e6618a15c2");
  const counts: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = String(r.is_verified);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  console.log(counts);

  // slug collisions
  const { data: slugCheck } = await supabase.from("venues").select("slug").in("slug", ["erica-jane","frankie-we-salute-you"]);
  console.log("slug collisions:", slugCheck);
}
main();
