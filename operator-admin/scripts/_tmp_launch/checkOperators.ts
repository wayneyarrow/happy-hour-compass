import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ids = [
  "d97665a1-3357-4cc3-a4c1-b69b5a30b2bf",
  "a9d7729d-943f-4ca9-b96b-424f885d9ea6",
  "561bc092-4965-47eb-814a-2e67c4e5f906",
  "ac329ae4-bed0-4d95-a656-a7756397da6a",
];

async function main() {
  const { data, error } = await supabase.from("operators").select("id,name,email,is_approved,role,created_at").in("id", ids);
  console.log(JSON.stringify(data, null, 2), error);

  // Check plan/subscription table if any
  const { data: subs } = await supabase.from("operator_subscriptions").select("*").in("operator_id", ids);
  console.log("SUBSCRIPTIONS:", JSON.stringify(subs, null, 2));
}
main();
