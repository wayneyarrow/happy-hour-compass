import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextBusinessDayIso,
  computeInitialSendTime,
  getLocalIsoDate,
  isBusinessDay,
  resolveVenueTimeZone,
} from "../../../src/lib/customerSuccess/deliveryScheduling";

// Anchor facts, independently verifiable: 2024-01-01 was a Monday.
//   Mon 01-01, Tue 01-02, Wed 01-03, Thu 01-04, Fri 01-05, Sat 01-06, Sun 01-07, Mon 01-08.

// ── Pure calendar math ───────────────────────────────────────────────────────

test("nextBusinessDayIso: Monday → Tuesday", () => {
  assert.equal(nextBusinessDayIso("2024-01-01"), "2024-01-02");
});

test("nextBusinessDayIso: Thursday → Friday", () => {
  assert.equal(nextBusinessDayIso("2024-01-04"), "2024-01-05");
});

test("nextBusinessDayIso: Friday → following Monday", () => {
  assert.equal(nextBusinessDayIso("2024-01-05"), "2024-01-08");
});

test("nextBusinessDayIso: Saturday → Monday", () => {
  assert.equal(nextBusinessDayIso("2024-01-06"), "2024-01-08");
});

test("nextBusinessDayIso: Sunday → Monday", () => {
  assert.equal(nextBusinessDayIso("2024-01-07"), "2024-01-08");
});

test("nextBusinessDayIso never returns the same day, even if it's already a business day", () => {
  assert.notEqual(nextBusinessDayIso("2024-01-01"), "2024-01-01");
});

test("isBusinessDay is true Mon-Fri, false Sat/Sun", () => {
  assert.equal(isBusinessDay(0), false); // Sunday
  assert.equal(isBusinessDay(1), true); // Monday
  assert.equal(isBusinessDay(5), true); // Friday
  assert.equal(isBusinessDay(6), false); // Saturday
});

// ── Timezone-aware wall-clock conversion ────────────────────────────────────

function formatLocal(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") parts[p.type] = p.value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}`;
}

const PACIFIC = "America/Vancouver";
const MOUNTAIN = "America/Edmonton"; // HHC's other real market timezone (Calgary)

test("Monday detection → Tuesday 3pm, Pacific", () => {
  const detectedAt = new Date("2024-01-01T20:00:00Z"); // Monday, ~noon Pacific
  const result = computeInitialSendTime(detectedAt, PACIFIC);
  assert.equal(formatLocal(result, PACIFIC), "2024-01-02 15:00");
});

test("Thursday detection → Friday 3pm, Mountain", () => {
  const detectedAt = new Date("2024-01-04T18:00:00Z"); // Thursday, ~11am Mountain
  const result = computeInitialSendTime(detectedAt, MOUNTAIN);
  assert.equal(formatLocal(result, MOUNTAIN), "2024-01-05 15:00");
});

test("Friday detection → Monday 3pm, Pacific", () => {
  const detectedAt = new Date("2024-01-05T17:00:00Z"); // Friday
  const result = computeInitialSendTime(detectedAt, PACIFIC);
  assert.equal(formatLocal(result, PACIFIC), "2024-01-08 15:00");
});

test("Saturday detection → Monday 3pm, Pacific", () => {
  const detectedAt = new Date("2024-01-06T17:00:00Z"); // Saturday
  const result = computeInitialSendTime(detectedAt, PACIFIC);
  assert.equal(formatLocal(result, PACIFIC), "2024-01-08 15:00");
});

test("Sunday detection → Monday 3pm, Mountain", () => {
  const detectedAt = new Date("2024-01-07T17:00:00Z"); // Sunday
  const result = computeInitialSendTime(detectedAt, MOUNTAIN);
  assert.equal(formatLocal(result, MOUNTAIN), "2024-01-08 15:00");
});

test("late-night detection still advances to the FOLLOWING business day, not the same one", () => {
  // Monday 11:58pm Pacific (~07:58 UTC Tuesday) — still Monday in Pacific local time.
  const detectedAt = new Date("2024-01-02T07:58:00Z");
  assert.equal(getLocalIsoDate(detectedAt, PACIFIC), "2024-01-01");
  const result = computeInitialSendTime(detectedAt, PACIFIC);
  assert.equal(formatLocal(result, PACIFIC), "2024-01-02 15:00");
});

test("DST spring-forward transition: still resolves to exactly 3:00pm local", () => {
  // Pacific DST began 2024-03-10. Detected the Friday before (03-08) — next
  // business day (03-11, Monday) is already in PDT; the conversion must
  // still land on exactly 15:00 local, not 14:00 or 16:00.
  const detectedAt = new Date("2024-03-08T18:00:00Z");
  const result = computeInitialSendTime(detectedAt, PACIFIC);
  assert.equal(formatLocal(result, PACIFIC), "2024-03-11 15:00");
});

// ── Pacific vs Mountain really do differ ────────────────────────────────────

test("the same detection instant produces a different UTC send time in Pacific vs Mountain", () => {
  const detectedAt = new Date("2024-01-01T20:00:00Z");
  const pacific = computeInitialSendTime(detectedAt, PACIFIC);
  const mountain = computeInitialSendTime(detectedAt, MOUNTAIN);
  assert.notEqual(pacific.getTime(), mountain.getTime());
  // Mountain is one hour ahead of Pacific, so its 3pm UTC instant is earlier.
  assert.ok(mountain.getTime() < pacific.getTime());
});

// ── resolveVenueTimeZone (impure, via fake client) ──────────────────────────

function makeFakeAdmin(venueRow: { market_id: string | null } | null, marketRow: { slug: string } | null) {
  return {
    from(table: string) {
      if (table === "venues") {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: venueRow, error: null }) };
              },
            };
          },
        };
      }
      if (table === "markets") {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: marketRow, error: null }) };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("resolveVenueTimeZone resolves via venues.market_id → markets.slug → getMarketTimeZone", async () => {
  const admin = makeFakeAdmin({ market_id: "market-uuid-1" }, { slug: "calgary" });
  const result = await resolveVenueTimeZone("venue-1", admin as never);
  assert.deepEqual(result, { ok: true, timeZone: "America/Edmonton" });
});

// Correction Pass Section 4: an unresolvable venue must never be silently
// defaulted to Pacific — it's reported as unresolvable so the caller can
// block/notify instead of guessing.
test("resolveVenueTimeZone reports unresolvable (not a silent Pacific default) when market_id is null", async () => {
  const admin = makeFakeAdmin({ market_id: null }, null);
  const result = await resolveVenueTimeZone("venue-2", admin as never);
  assert.deepEqual(result, { ok: false });
});

test("resolveVenueTimeZone reports unresolvable when the market row is missing", async () => {
  const admin = makeFakeAdmin({ market_id: "orphan-market-id" }, null);
  const result = await resolveVenueTimeZone("venue-3", admin as never);
  assert.deepEqual(result, { ok: false });
});

test("resolveVenueTimeZone reports unresolvable when the venue row itself is missing", async () => {
  const admin = makeFakeAdmin(null, null);
  const result = await resolveVenueTimeZone("venue-missing", admin as never);
  assert.deepEqual(result, { ok: false });
});
