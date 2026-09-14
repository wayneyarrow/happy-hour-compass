/**
 * Venue-local scheduling math for Customer Success delivery (Phase 1B).
 *
 * Pure date/timezone functions — no Supabase, no I/O — plus one small
 * impure lookup (resolveVenueTimeZone) that resolves a venue's IANA
 * timezone through HHC's existing canonical source rather than inventing a
 * second timezone model.
 *
 * TIMEZONE SOURCE (investigated, not assumed):
 *   getMarketTimeZone() (src/lib/marketLocalDate.ts) is the one existing
 *   canonical per-market IANA timezone source in this codebase — already
 *   used by todaysSpecialsHomepage.ts and homepagesRendering.ts for
 *   market-local "today" calculations, and already correctly distinguishes
 *   Pacific (BC markets) from Mountain (Calgary) rather than assuming one
 *   timezone platform-wide. venues.market_id (migration
 *   048_geography_foundation_v1.sql) is a UUID FK to public.markets(id);
 *   public.markets.slug matches MARKETS[].id in markets.ts 1:1 (see that
 *   migration's own COMMENT ON TABLE) — so venue → timezone is
 *   venues.market_id → markets.slug → getMarketTimeZone(slug).
 *
 *   This is deliberately NOT the same convention getCurrentDayName()
 *   (happyHourStatus.ts) uses for the consumer Happy-Hour-status widget —
 *   that one intentionally uses the viewer's own local clock because "no
 *   venue timezone data exists anywhere in the product" for THAT feature's
 *   purposes. For scheduling an actual send time, the real per-market
 *   timezone source is the correct one to use, and it does exist.
 *
 *   venues.market_id is nullable (legacy venues predating the geography
 *   migration). Correction Pass Section 4: when it's null, or the markets
 *   lookup fails, resolveVenueTimeZone() below returns `{ ok: false }`
 *   rather than silently defaulting to Pacific — see that function's own
 *   comment for why a silent default is wrong here specifically, even
 *   though getMarketTimeZone() itself does default (correctly, for ITS
 *   callers — a market-local "today" is a much lower-stakes guess than an
 *   actual scheduled send time for a venue whose real timezone is unknown).
 */

import { getWeekdayFromIsoDate } from "@/lib/dailySpecialSchedule";
import type { Weekday } from "@/lib/dailySpecialTypes";
import { getMarketTimeZone } from "@/lib/marketLocalDate";
import { createAdminClient } from "@/lib/supabase/server";

/** 3:00 PM venue-local — the approved initial-send target (Section 5). */
export const TARGET_SEND_HOUR = 15;
export const TARGET_SEND_MINUTE = 0;

// ── Pure calendar helpers ───────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" for `instant` as observed in `timeZone`. */
export function getLocalIsoDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function addIsoDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Monday(1)–Friday(5), matching the existing Weekday (0=Sunday..6=Saturday) convention. */
export function isBusinessDay(weekday: Weekday): boolean {
  return weekday >= 1 && weekday <= 5;
}

/**
 * The next business day strictly after `isoDate` — never returns `isoDate`
 * itself, even if it is already a business day (Section 5: "Do not send at
 * 3 PM on the same calendar day the milestone was detected").
 */
export function nextBusinessDayIso(isoDate: string): string {
  let candidate = addIsoDays(isoDate, 1);
  for (;;) {
    const weekday = getWeekdayFromIsoDate(candidate);
    if (weekday !== null && isBusinessDay(weekday)) return candidate;
    candidate = addIsoDays(candidate, 1);
  }
}

// ── Local wall-clock → UTC instant (DST-correct, no external dependency) ───

/**
 * Formats `instant` in `timeZone` and reinterprets those wall-clock digits
 * as if they were UTC — the standard building block for a DST-correct
 * local→UTC conversion via Intl alone (no date-fns-tz/luxon dependency;
 * matches this codebase's existing convention of hand-rolling timezone
 * math with Intl.DateTimeFormat — see marketLocalDate.ts, controlPanelDateTime.ts).
 */
function formatAsIfUtc(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  // Some ICU builds render midnight as "24" with hour12:false — normalize.
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
}

/**
 * The UTC instant corresponding to `hour:minute` local wall-clock time on
 * `isoDate` in `timeZone`.
 *
 * Fixed-point iteration relative to the ORIGINAL target (`targetMs`, held
 * constant): each pass re-samples the timezone's offset AT the current
 * candidate instant (via formatAsIfUtc) and corrects the candidate back
 * toward the fixed target — `candidateMs = candidateMs - asIfLocalMs(candidateMs)
 * + targetMs`. This converges (and then stays fixed) even when the initial
 * naive guess and the true answer fall on opposite sides of a DST
 * transition, because each correction is always measured against the same
 * fixed target rather than compounding from the previous candidate.
 */
export function localWallTimeToUtc(isoDate: string, hour: number, minute: number, timeZone: string): Date {
  const targetMs = Date.parse(`${isoDate}T${pad2(hour)}:${pad2(minute)}:00.000Z`);
  let candidateMs = targetMs;
  for (let i = 0; i < 2; i++) {
    const asIfLocalMs = formatAsIfUtc(new Date(candidateMs), timeZone);
    candidateMs = candidateMs - asIfLocalMs + targetMs;
  }
  return new Date(candidateMs);
}

// ── Public scheduling entry point ───────────────────────────────────────────

/**
 * The initial send target for a milestone detected at `detectedAt`
 * (venue-local), in the given IANA `timeZone`: 3:00 PM on the next
 * business day. See module header for "next business day" semantics and
 * the Section 5 worked examples this satisfies.
 */
export function computeInitialSendTime(detectedAt: Date, timeZone: string): Date {
  const detectedLocalIso = getLocalIsoDate(detectedAt, timeZone);
  const targetIso = nextBusinessDayIso(detectedLocalIso);
  return localWallTimeToUtc(targetIso, TARGET_SEND_HOUR, TARGET_SEND_MINUTE, timeZone);
}

// ── Venue timezone lookup (impure) ──────────────────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>;

export type VenueTimeZoneResolution = { ok: true; timeZone: string } | { ok: false };

/**
 * Resolves a venue's IANA timezone via venues.market_id → markets.slug →
 * getMarketTimeZone(slug).
 *
 * Correction Pass Section 4: this deliberately does NOT fall back to a
 * default timezone when market_id is null or the markets lookup fails —
 * silently defaulting an unresolvable venue to Pacific would schedule its
 * send at the WRONG local time for a venue that might not even be in the
 * Pacific timezone, with no visibility that anything was wrong. The caller
 * (scheduleNewlyPendingEvents in processCustomerSuccessDeliveries.ts)
 * instead treats `{ ok: false }` as a recoverable, Slack-visible blocked
 * state ('no_resolvable_timezone') — the same mechanism as a
 * recipient-resolution block — and retries resolution on every future run
 * rather than guessing once and never revisiting it.
 */
export async function resolveVenueTimeZone(venueId: string, admin: AdminClient): Promise<VenueTimeZoneResolution> {
  const { data: venue } = await admin.from("venues").select("market_id").eq("id", venueId).maybeSingle();
  const marketId = (venue as { market_id: string | null } | null)?.market_id ?? null;
  if (!marketId) return { ok: false };

  const { data: market } = await admin.from("markets").select("slug").eq("id", marketId).maybeSingle();
  const slug = (market as { slug: string | null } | null)?.slug ?? null;
  if (!slug) return { ok: false };

  return { ok: true, timeZone: getMarketTimeZone(slug) };
}
