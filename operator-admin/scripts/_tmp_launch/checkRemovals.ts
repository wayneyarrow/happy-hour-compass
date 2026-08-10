import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REMOVE_NAMES = [
  "Garden Bistro at Peak Cellars",
  "Gather Restaurant",
  "Hugo's Mexican Kitchen",
  "Kettle River Brewing Co.",
  "La Vela Pizzeria",
  "Laneway Canteen",
  "Sol Korea Restaurant",
  "Wings – Rutland",
];

async function main() {
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id,name,slug,source,is_published,claimed_at,claimed_by,created_by_operator_id,updated_by_operator_id")
    .in("name", REMOVE_NAMES);
  if (error) throw error;
  console.log(JSON.stringify(venues, null, 2));

  const ids = (venues ?? []).map((v) => v.id);

  for (const table of [
    "venue_view_events",
    "venue_click_events",
    "venue_save_events",
    "venue_discover_events",
    "events",
    "media",
    "venue_claims",
    "venue_notes",
    "saved_venues",
    "content_guide_venues",
    "homepage_sections",
    "operator_submissions",
  ]) {
    try {
      const { count, error: cErr } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .in("venue_id", ids);
      if (cErr) {
        console.log(table, "ERROR", cErr.message);
      } else {
        console.log(table, "count:", count);
      }
    } catch (e) {
      console.log(table, "EXCEPTION", e);
    }
  }
}
main();
