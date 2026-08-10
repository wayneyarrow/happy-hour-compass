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
    .select("id,name")
    .in("name", REMOVE_NAMES);
  if (error) throw error;
  if (!venues || venues.length !== REMOVE_NAMES.length) {
    console.error("MISMATCH: expected", REMOVE_NAMES.length, "found", venues?.length);
    console.log(venues);
    process.exit(1);
  }
  const ids = venues.map((v) => v.id);
  console.log("Deleting venue IDs:", ids);

  // Step 1: delete blocking analytics rows (no ON DELETE CASCADE on these tables)
  for (const table of ["venue_view_events", "venue_click_events", "venue_save_events", "venue_discover_events"]) {
    const { error: delErr, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .in("venue_id", ids);
    if (delErr) {
      console.error(`FAILED deleting from ${table}:`, delErr.message);
      process.exit(1);
    }
    console.log(`Deleted ${count ?? 0} row(s) from ${table}`);
  }

  // Step 2: delete the venues themselves (cascades claims/notes/media/content_guide_venues/etc.)
  const { error: venueDelErr, count: venueDelCount } = await supabase
    .from("venues")
    .delete({ count: "exact" })
    .in("id", ids);

  if (venueDelErr) {
    console.error("FAILED deleting venues:", venueDelErr.message);
    process.exit(1);
  }
  console.log(`Deleted ${venueDelCount} venue(s).`);
}
main();
