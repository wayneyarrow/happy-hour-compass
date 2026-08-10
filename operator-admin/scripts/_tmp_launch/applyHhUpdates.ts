import * as path from "path";
import * as dotenv from "dotenv";
import * as fs from "fs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SpecialItem = { name: string; price?: string; notes?: string };
type ExistingRow = {
  venue_id: string;
  name: string;
  hh_times: string;
  hh_times_raw_csv: string;
  hh_times_override_reason: string | null;
  hh_food_details: SpecialItem[];
  hh_drink_details: SpecialItem[];
};

const payloadPath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8")) as {
  existing: ExistingRow[];
  new_venues: unknown[];
};

function toJsonOrNull(items: SpecialItem[]): string | null {
  return items.length > 0 ? JSON.stringify(items) : null;
}

async function main() {
  let updated = 0;
  const failures: { name: string; error: string }[] = [];

  for (const row of payload.existing) {
    const { error, count } = await supabase
      .from("venues")
      .update({
        hh_times: row.hh_times,
        hh_food_details: toJsonOrNull(row.hh_food_details),
        hh_drink_details: toJsonOrNull(row.hh_drink_details),
        hh_times_needs_review: false,
      }, { count: "exact" })
      .eq("id", row.venue_id);

    if (error) {
      failures.push({ name: row.name, error: error.message });
      console.error(`FAILED: ${row.name} (${row.venue_id}): ${error.message}`);
    } else {
      updated++;
    }
  }

  console.log(`\nUpdated ${updated} / ${payload.existing.length} venues.`);
  if (failures.length) {
    console.log("FAILURES:", JSON.stringify(failures, null, 2));
  }
}

main();
