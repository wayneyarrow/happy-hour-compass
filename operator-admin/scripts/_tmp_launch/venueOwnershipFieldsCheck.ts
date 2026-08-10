import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function count(filter: (q: any) => any) {
  let q = supabase.from("venues").select("*", { count: "exact", head: true });
  q = filter(q);
  const { count: c, error } = await q;
  if (error) throw error;
  return c;
}

async function main() {
  console.log("claimed_by set:", await count((q) => q.not("claimed_by", "is", null)));
  console.log("claimed_at set:", await count((q) => q.not("claimed_at", "is", null)));
  console.log("is_verified true:", await count((q) => q.eq("is_verified", true)));
  console.log("created_by_operator_id set:", await count((q) => q.not("created_by_operator_id", "is", null)));
  console.log("updated_by_operator_id set:", await count((q) => q.not("updated_by_operator_id", "is", null)));
  console.log("cancelled_at set:", await count((q) => q.not("cancelled_at", "is", null)));
  console.log("cancellation_reason set:", await count((q) => q.not("cancellation_reason", "is", null)));
  console.log("cancelled_by_operator_id set:", await count((q) => q.not("cancelled_by_operator_id", "is", null)));

  const { data: rc } = await supabase.from("venues").select("id,name,review_confirmations").not("review_confirmations", "eq", "{}");
  console.log("review_confirmations non-empty count:", rc?.length);
  console.log(JSON.stringify(rc, null, 2));

  const { data: cancelled } = await supabase.from("venues").select("id,name,cancelled_at,cancellation_reason,cancelled_by_operator_id").not("cancelled_at", "is", null);
  console.log("cancelled venues:", JSON.stringify(cancelled, null, 2));

  // events with operator link
  const { count: evCreated } = await supabase.from("events").select("*", { count: "exact", head: true }).not("created_by_operator_id", "is", null);
  const { count: evUpdated } = await supabase.from("events").select("*", { count: "exact", head: true }).not("updated_by_operator_id", "is", null);
  console.log("events with created_by_operator_id set:", evCreated);
  console.log("events with updated_by_operator_id set:", evUpdated);
}
main();
