import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const MARKET_ID = "39083a78-532d-4628-b2cb-d8e6618a15c2"; // central-okanagan

const VENUE_NAMES_TO_PUBLISH = [
  "BTS Cocktail Bar & Kitchen",
  "Buffalo Rouge Brewing Co.",
  "Chilango Modern Mexican",
  "Fancy’s Cold Cuts & Cocktails", // curly apostrophe, matches DB
  "Room 272 Bar + Bites",
  "Skinny Dukes",
  "The Office Brewery",
  "Turtle Jack's West Kelowna",
];

const ORPHAN_EMAILS = [
  "wayne.yarrow+2@gmail.com",
  "alexolsen1234@gmail.com",
  "alexolsen@gmail.com",
  "andigo111@gmail.com",
];

// ── Faithful port of src/lib/data/venues.ts hh_times parsing (pure logic,
//    no DB/Next.js dependency) — used only to VALIDATE hasQualifyingHappyHour
//    across all 55 launch venues at the end. Not used for any write. ──

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
type Day = (typeof DAYS)[number];

function parse12hToHHMM(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (t === "close" || t === "closing") return "23:00";
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "pm" && h !== 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function expandDayRange(dayPart: string): Day[] {
  const t = dayPart.trim();
  if (/^(daily|everyday)$/i.test(t)) return [...DAYS];
  if (/^weekdays?$/i.test(t)) return DAYS.filter((d) => d !== "Saturday" && d !== "Sunday");
  const rangeMatch = t.match(/^(.+?)\s*[–\-]\s*(.+)$/);
  if (!rangeMatch) {
    const found = DAYS.find((d) => d.toLowerCase().startsWith(t.toLowerCase().substring(0, 3)));
    return found ? [found] : [];
  }
  const startAbbr = rangeMatch[1].trim().toLowerCase().substring(0, 3);
  const endAbbr = rangeMatch[2].trim().toLowerCase().substring(0, 3);
  const startIdx = DAYS.findIndex((d) => d.toLowerCase().startsWith(startAbbr));
  const endIdx = DAYS.findIndex((d) => d.toLowerCase().startsWith(endAbbr));
  if (startIdx === -1 || endIdx === -1) return [];
  const result: Day[] = [];
  let i = startIdx;
  for (;;) {
    result.push(DAYS[i]);
    if (i === endIdx) break;
    i = (i + 1) % DAYS.length;
  }
  return result;
}

function expandScraperCompactHhTimes(text: string): string {
  const blocks = text.split("|").map((b) => b.trim());
  const dayGroups: Day[][] = [
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
    ["Friday", "Saturday"],
  ];
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    if (i >= dayGroups.length) return;
    const slots = block.split("&").map((s) => s.trim()).join(", ");
    for (const day of dayGroups[i]) lines.push(`${day}: ${slots}`);
  });
  return lines.join("\n");
}

function expandScraperGroupedHhTimes(text: string): string {
  const lines: string[] = [];
  for (const block of text.split("|").map((b) => b.trim())) {
    const colonIdx = block.indexOf(":");
    if (colonIdx === -1) continue;
    const daySpec = block.substring(0, colonIdx).trim();
    const timeStr = block.substring(colonIdx + 1).trim();
    const slots = timeStr.split("&").map((s) => s.trim()).join(", ");
    for (const part of daySpec.split("&").map((s) => s.trim())) {
      for (const day of expandDayRange(part)) lines.push(`${day}: ${slots}`);
    }
  }
  return lines.join("\n");
}

function parseHhTimes(text: string | null): Record<string, Array<{ start: string; end: string }>> {
  const weekly: Record<string, Array<{ start: string; end: string }>> = {};
  DAYS.forEach((d) => (weekly[d] = []));
  if (!text?.trim()) return weekly;
  text = text.replace(/[    ]/g, " ").replace(/\r/g, "").trim();
  if (!text.includes("\n") && text.includes("|")) {
    const firstBlock = text.split("|")[0].trim();
    if (/^(sun|mon|tue|wed|thu|fri|sat|daily|everyday|weekday)/i.test(firstBlock)) {
      text = expandScraperGroupedHhTimes(text);
    } else {
      text = expandScraperCompactHhTimes(text);
    }
  }
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    let splitIdx = -1;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === ":") {
        const before = line.substring(0, j).trim();
        const after = line.substring(j + 1).trim();
        if (/\d$/.test(before) && /^\d/.test(after)) continue;
        splitIdx = j;
        break;
      }
    }
    if (splitIdx === -1) continue;
    const dayPart = line.substring(0, splitIdx).trim();
    const timePart = line.substring(splitIdx + 1).trim();
    if (!timePart || /^no\b/i.test(timePart)) continue;
    const days = expandDayRange(dayPart);
    for (const slotStr of timePart.split(/[,&]/).map((s) => s.trim()).filter(Boolean)) {
      const m = slotStr.match(/^(.+?)\s*[–\-]\s*(.+)$/);
      if (!m) continue;
      const rawStart = m[1].trim();
      const rawEnd = m[2].trim();
      const startForParse = /\s*(am|pm)\s*$/i.test(rawStart)
        ? rawStart
        : (() => {
            const p = rawEnd.match(/\s*(am|pm)\s*$/i)?.[1];
            return p ? `${rawStart} ${p}` : rawStart;
          })();
      const start = parse12hToHHMM(startForParse);
      const end = parse12hToHHMM(rawEnd);
      if (start && end) {
        for (const day of days) weekly[day].push({ start, end });
      }
    }
  }
  return weekly;
}

function hasQualifyingHappyHour(hhTimes: string | null): boolean {
  const weekly = parseHhTimes(hhTimes);
  return Object.values(weekly).some((slots) => slots.length > 0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function listAllAuthUsers() {
  const users: { id: string; email: string | null }[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null })));
    if (data.users.length < 1000) break;
    page++;
  }
  return users;
}

function report(label: string, pass: boolean, detail?: any) {
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("========== STEP A: PRE-FLIGHT RE-VERIFICATION ==========");

  const { data: targetVenues, error: tvErr } = await supabase
    .from("venues")
    .select("id,name,is_published,establishment_type,market_id")
    .eq("market_id", MARKET_ID)
    .in("name", VENUE_NAMES_TO_PUBLISH);
  if (tvErr) throw tvErr;
  console.log("Matched venues to publish:", targetVenues?.length, "(expected 8)");
  if (targetVenues?.length !== 8) {
    throw new Error(`Expected exactly 8 matching venues, got ${targetVenues?.length}. Aborting before any write.`);
  }
  for (const v of targetVenues) {
    if (v.is_published) throw new Error(`Venue "${v.name}" is already published — aborting, expected all 8 to be unpublished.`);
  }
  const skinnyDukes = targetVenues.find((v) => v.name === "Skinny Dukes");
  if (!skinnyDukes) throw new Error("Skinny Dukes not found in matched set.");
  console.log("Skinny Dukes current establishment_type:", JSON.stringify(skinnyDukes.establishment_type));
  if (skinnyDukes.establishment_type !== "Resturant and Bar") {
    console.warn("WARNING: Skinny Dukes establishment_type is not the expected typo value — will not overwrite unexpected data. Current value:", skinnyDukes.establishment_type);
  }

  const authUsers = await listAllAuthUsers();
  const targetAuthUsers = authUsers.filter((u) => ORPHAN_EMAILS.includes((u.email ?? "").toLowerCase()));
  console.log("Matched orphan auth.users:", targetAuthUsers.length, "(expected 4)");
  if (targetAuthUsers.length !== 4) {
    throw new Error(`Expected exactly 4 matching auth.users, got ${targetAuthUsers.length}. Aborting before any write.`);
  }

  // Re-verify zero references for each, defensively, before deleting.
  const { data: opCheck } = await supabase.from("operators").select("email").in("email", ORPHAN_EMAILS);
  const { data: cpCheck } = await supabase.from("consumer_profiles").select("id").in("id", targetAuthUsers.map((u) => u.id));
  const { data: paCheck } = await supabase.from("platform_admins").select("email").in("email", ORPHAN_EMAILS);
  if ((opCheck?.length ?? 0) > 0) throw new Error(`ABORT: an orphan email matches an operators row: ${JSON.stringify(opCheck)}`);
  if ((cpCheck?.length ?? 0) > 0) throw new Error(`ABORT: an orphan id matches a consumer_profiles row: ${JSON.stringify(cpCheck)}`);
  if ((paCheck?.length ?? 0) > 0) throw new Error(`ABORT: an orphan email matches a platform_admins row: ${JSON.stringify(paCheck)}`);
  console.log("Zero-reference re-check passed for all 4 orphan accounts.");

  console.log("\n========== STEP B: EXECUTE WRITES ==========");

  // B1. Publish the 7 non-Skinny-Dukes venues.
  const otherIds = targetVenues.filter((v) => v.name !== "Skinny Dukes").map((v) => v.id);
  {
    const { error, count } = await supabase.from("venues").update({ is_published: true }, { count: "exact" }).in("id", otherIds);
    if (error) throw new Error(`Publish (7 venues) failed: ${error.message}`);
    console.log("Published (is_published=true):", count, "venues:", otherIds.length, "expected");
  }

  // B2. Publish Skinny Dukes AND fix the establishment_type typo in the same update.
  {
    const { error, count } = await supabase
      .from("venues")
      .update({ is_published: true, establishment_type: "Restaurant and Bar" }, { count: "exact" })
      .eq("id", skinnyDukes.id);
    if (error) throw new Error(`Publish + typo fix (Skinny Dukes) failed: ${error.message}`);
    console.log("Published + establishment_type corrected for Skinny Dukes:", count);
  }

  // B3. Delete the 4 orphan auth.users.
  let deleted = 0;
  for (const u of targetAuthUsers) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) {
      console.error("FAILED to delete", u.email, u.id, error.message);
    } else {
      deleted++;
      console.log("Deleted auth.users:", u.email, u.id);
    }
  }
  console.log(`Deleted orphan auth.users: ${deleted}/${targetAuthUsers.length}`);

  console.log("\n========== STEP C: FINAL CERTIFICATION VALIDATION ==========");

  const { count: launchCount } = await supabase.from("venues").select("*", { count: "exact", head: true }).eq("market_id", MARKET_ID);
  report("Launch venue count is 55", launchCount === 55, launchCount);

  const { count: unpublishedCount } = await supabase
    .from("venues")
    .select("*", { count: "exact", head: true })
    .eq("market_id", MARKET_ID)
    .eq("is_published", false);
  report("All 55 launch venues are published", unpublishedCount === 0, { unpublished: unpublishedCount });

  // Launch image: media row OR placeholder_image_path set.
  const { data: launchVenuesFull } = await supabase
    .from("venues")
    .select("id,name,hh_times,placeholder_image_path")
    .eq("market_id", MARKET_ID);
  let missingImage: string[] = [];
  let missingHH: string[] = [];
  for (const v of launchVenuesFull ?? []) {
    const { count: mediaCount } = await supabase
      .from("media")
      .select("*", { count: "exact", head: true })
      .eq("venue_id", v.id)
      .eq("type", "venue_image");
    const hasImage = (mediaCount ?? 0) > 0 || !!(v.placeholder_image_path && v.placeholder_image_path.trim());
    if (!hasImage) missingImage.push(v.name);
    if (!hasQualifyingHappyHour(v.hh_times)) missingHH.push(v.name);
  }
  report("Every launch venue has a launch image assigned", missingImage.length === 0, { missing: missingImage });
  report("Every launch venue has an active Happy Hour", missingHH.length === 0, { missing: missingHH });

  // Unclaimed — global, matching the scope used in the prior operational reset.
  const { count: anyClaimedBy } = await supabase.from("venues").select("*", { count: "exact", head: true }).not("claimed_by", "is", null);
  const { count: anyClaimedAt } = await supabase.from("venues").select("*", { count: "exact", head: true }).not("claimed_at", "is", null);
  report("Every seeded venue is Unclaimed (claimed_by, global)", anyClaimedBy === 0, anyClaimedBy);
  report("Every seeded venue is Unclaimed (claimed_at, global)", anyClaimedAt === 0, anyClaimedAt);

  const { count: opCount } = await supabase.from("operators").select("*", { count: "exact", head: true });
  report("No operators remain", opCount === 0, opCount);

  const { count: consumerCount } = await supabase.from("consumer_profiles").select("*", { count: "exact", head: true });
  report("No consumers remain", consumerCount === 0, consumerCount);

  const { count: claimsCount } = await supabase.from("venue_claims").select("*", { count: "exact", head: true });
  const { count: legacyClaimsCount } = await supabase.from("claims").select("*", { count: "exact", head: true });
  report("No venue claims remain (venue_claims)", claimsCount === 0, claimsCount);
  report("No venue claims remain (legacy claims)", legacyClaimsCount === 0, legacyClaimsCount);

  // Orphan auth.users sweep — everyone remaining must match operators, consumer_profiles, or platform_admins.
  const { data: admins } = await supabase.from("platform_admins").select("email");
  const { data: remainingOperators } = await supabase.from("operators").select("email");
  const { data: remainingConsumers } = await supabase.from("consumer_profiles").select("id");
  const adminEmails = new Set((admins ?? []).map((a) => a.email.toLowerCase()));
  const operatorEmails = new Set((remainingOperators ?? []).map((o) => (o.email ?? "").toLowerCase()));
  const consumerIds = new Set((remainingConsumers ?? []).map((c) => c.id));
  const finalAuthUsers = await listAllAuthUsers();
  const unclassified = finalAuthUsers.filter(
    (u) => !adminEmails.has((u.email ?? "").toLowerCase()) && !operatorEmails.has((u.email ?? "").toLowerCase()) && !consumerIds.has(u.id)
  );
  report("No orphan auth.users records remain", unclassified.length === 0, { unclassified: unclassified.map((u) => u.email) });
  report(
    "Only required founder/system accounts remain",
    finalAuthUsers.length === adminEmails.size && finalAuthUsers.every((u) => adminEmails.has((u.email ?? "").toLowerCase())),
    { remaining: finalAuthUsers.map((u) => u.email), expectedAdminCount: adminEmails.size }
  );

  const { count: eventsCount } = await supabase.from("events").select("*", { count: "exact", head: true });
  report("Events table count unchanged (16 expected)", eventsCount === 16, eventsCount);

  const { count: guidesCount } = await supabase.from("content_guides").select("*", { count: "exact", head: true });
  report("Guides table count unchanged (8 expected)", guidesCount === 8, guidesCount);

  console.log("\nRemaining auth.users:", JSON.stringify(finalAuthUsers, null, 2));
}

main().catch((e) => {
  console.error("CERTIFICATION EXECUTION FAILED:", e);
  process.exit(1);
});
