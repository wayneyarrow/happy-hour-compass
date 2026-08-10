import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
async function main() {
  const { data } = await supabase
    .from("venues")
    .select("id,name,is_published,cancelled_at,cancellation_reason,cancelled_by_operator_id,claimed_by,created_by_operator_id")
    .or("cancellation_reason.not.is.null,cancelled_by_operator_id.not.is.null");
  console.log(JSON.stringify(data, null, 2));
}
main();
