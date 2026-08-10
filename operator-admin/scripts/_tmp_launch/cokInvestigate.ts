import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const MARKET_ID = "39083a78-532d-4628-b2cb-d8e6618a15c2";

async function main() {
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id,name,is_published,is_verified,claimed_at,claimed_by,created_by_operator_id,updated_by_operator_id,source")
    .eq("market_id", MARKET_ID)
    .order("name");
  if (error) throw error;

  console.log("Total:", venues?.length);
  console.log("\nUnpublished venues in central-okanagan:");
  console.table((venues ?? []).filter((v) => !v.is_published).map((v) => ({ name: v.name, source: v.source, is_verified: v.is_verified })));

  console.log("\nVenues with is_verified=true:", (venues ?? []).filter((v) => v.is_verified).length);
  console.log("\nVenues with claimed_by set:", (venues ?? []).filter((v) => v.claimed_by).length);
  console.log("Venues with claimed_at set:", (venues ?? []).filter((v) => v.claimed_at).length);
  console.log("Venues with created_by_operator_id set:", (venues ?? []).filter((v) => v.created_by_operator_id).length);
  console.log("Venues with updated_by_operator_id set:", (venues ?? []).filter((v) => v.updated_by_operator_id).length);

  console.log("\nFull ownership-flag rows (any flag set):");
  console.table(
    (venues ?? [])
      .filter((v) => v.is_verified || v.claimed_by || v.claimed_at || v.created_by_operator_id || v.updated_by_operator_id)
      .map((v) => ({
        name: v.name,
        is_published: v.is_published,
        is_verified: v.is_verified,
        claimed_at: v.claimed_at,
        claimed_by: v.claimed_by,
        created_by_operator_id: v.created_by_operator_id,
        updated_by_operator_id: v.updated_by_operator_id,
      }))
  );

  // venue_claims for this market's venues
  const ids = (venues ?? []).map((v) => v.id);
  const { data: claims } = await supabase.from("venue_claims").select("id,venue_id,status,email").in("venue_id", ids);
  console.log("\nvenue_claims referencing central-okanagan venues:", claims?.length);
  console.table(claims);
}
main();
