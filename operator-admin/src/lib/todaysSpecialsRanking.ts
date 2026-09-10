/**
 * Today's Specials homepage section — selection/ranking layer.
 *
 * Pure, framework-agnostic, no I/O (no Supabase, no `new Date()`) — every
 * input (eligible-today candidates, view counts, `todayIso`, overrides) is
 * passed in explicitly so this is directly unit-testable and so a Server
 * Component only has to fetch data and call selectTodaysSpecials(), never
 * re-derive ranking rules itself (see this task's "clear, testable
 * selection/ranking layer rather than putting ranking logic directly into
 * the React component" requirement).
 *
 * Pipeline: eligible today -> score -> one per venue -> rank -> diversify -> cap.
 *
 * Manual-override compatibility (see this task's CPanel investigation):
 * `overrides` mirrors the EXISTING Collections override model
 * (CollectionVenueOverride/CollectionEventOverride in collectionsShared.ts —
 * `action: "include" | "exclude"` + `boost: number`) applied per Daily
 * Special id rather than per venue. No `daily_special_overrides` table
 * exists yet, so every call site passes `overrides: []` today — but the
 * merge semantics below (exclude removes from the eligible pool before
 * scoring; a forced "include" always wins its venue's slot; `boost` is
 * checked before any organic signal, exactly like Collections' own
 * boost-lifts-first sort) are already wired so a future
 * `daily_special_overrides` table can be read straight into this same
 * `overrides` array with zero change to the algorithm itself.
 */

import { occursOnDate } from "@/lib/dailySpecialSchedule";
import type { WebsiteDailySpecialListItem } from "@/lib/data/dailySpecials";

export const TODAYS_SPECIALS_DEFAULT_LIMIT = 6;

// ── Ranking constants (modest first-pass weights — see task brief: "Build
// a clear, testable selection/ranking layer" + "meaningful but NOT
// absolute" for both the verified and popularity signals) ──────────────────

/** Flat bonus for a Special whose venue is platform-verified (venues.is_verified — see dailySpecials.ts's WebsiteDailySpecialListItem.venueIsVerified comment). Comparable in magnitude to the popularity cap below, so neither signal alone guarantees a win. */
const VERIFIED_VENUE_BOOST = 20;

/** Recent (last-30-days) venue views beyond this stop adding further score — caps a single high-traffic venue from dominating regardless of how much busier it is than everything else. */
const MAX_POPULARITY_VIEWS = 50;

/** Scaled so the popularity signal's maximum possible contribution equals VERIFIED_VENUE_BOOST — same order of magnitude, neither dominates the other by construction. */
const POPULARITY_WEIGHT = VERIFIED_VENUE_BOOST / MAX_POPULARITY_VIEWS;

/**
 * Candidates within this many merit-score points of each other are treated
 * as "comparable" for diversity purposes — a soft preference among genuine
 * near-ties, not a rigid quota (see selectTodaysSpecials()'s diversity
 * step). Deliberately small relative to the 0-20 merit-score range (verified
 * boost + capped popularity): a wide band would let a meaningfully weaker
 * candidate leapfrog a clearly stronger one merely for type variety, which
 * is a quota, not a soft preference. 3 points is roughly "a small handful
 * of recent views apart" — close enough that a founder wouldn't mind either
 * winning, not close enough to overrule a real ranking gap.
 */
const DIVERSITY_SCORE_BAND = 3;

// ── Manual override extension point (no schema yet — see module header) ────

export type TodaysSpecialOverride = {
  dailySpecialId: string;
  action: "include" | "exclude";
  /** Higher wins. 0 = no explicit boost (still eligible for organic ranking if action is "include"). */
  boost: number;
};

// ── Deterministic tie-break (no Math.random in server rendering) ───────────

/** Small, stable string hash (djb2) — deterministic across runs/processes, unlike object identity or Math.random(). */
function djb2Hash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0; // unsigned 32-bit
}

/**
 * Stable tie-break seed for one candidate on one market-local calendar
 * day: identical inputs always produce the identical value (so refreshes
 * within the same day never reorder ties), while a different `todayIso`
 * naturally produces a different seed (so a new day can produce a
 * different tie-break order without any special-casing).
 */
export function deterministicTieBreakSeed(todayIso: string, dailySpecialId: string): number {
  return djb2Hash(`${todayIso}:${dailySpecialId}`);
}

// ── Selection ────────────────────────────────────────────────────────────────

export type TodaysSpecialCandidateInput = {
  special: WebsiteDailySpecialListItem;
  /** Last-30-days view count for this Special's venue (see getVenueViewCounts() in viewCounts.ts). Omitted/0 when no signal is available for this venue. */
  venueViews?: number;
};

export type SelectTodaysSpecialsInput = {
  /** Already market-scoped, published-Special/published-venue candidates — see getPublishedDailySpecialsForWebsite(). Eligibility-today filtering happens inside this function, not before it. */
  candidates: TodaysSpecialCandidateInput[];
  /** Market-local "YYYY-MM-DD" — see marketLocalDate.ts. Never a raw UTC date. */
  todayIso: string;
  /** Future founder curation input — always [] until a daily_special_overrides table exists (see module header). */
  overrides?: TodaysSpecialOverride[];
  limit?: number;
};

type ScoredCandidate = {
  special: WebsiteDailySpecialListItem;
  /** From an override row, or 0 when none applies. Checked before meritScore, mirroring Collections' boost-lifts-first ordering. */
  overrideBoost: number;
  /** Organic signal only (verified + popularity) — never includes overrideBoost. */
  meritScore: number;
  forcedInclude: boolean;
  tieBreak: number;
};

/** True when `a` should be ranked above `b`: override boost first, then merit score, then the deterministic tie-break (lower seed wins — arbitrary but stable). */
function isHigherRanked(a: ScoredCandidate, b: ScoredCandidate): boolean {
  if (a.overrideBoost !== b.overrideBoost) return a.overrideBoost > b.overrideBoost;
  if (a.meritScore !== b.meritScore) return a.meritScore > b.meritScore;
  return a.tieBreak < b.tieBreak;
}

function scoreCandidate(
  input: TodaysSpecialCandidateInput,
  overrideById: Map<string, TodaysSpecialOverride>,
  todayIso: string
): ScoredCandidate {
  const override = overrideById.get(input.special.id);
  const verified = input.special.venueIsVerified ? VERIFIED_VENUE_BOOST : 0;
  const popularity = Math.min(input.venueViews ?? 0, MAX_POPULARITY_VIEWS) * POPULARITY_WEIGHT;
  return {
    special: input.special,
    overrideBoost: override?.boost ?? 0,
    meritScore: verified + popularity,
    forcedInclude: override?.action === "include",
    tieBreak: deterministicTieBreakSeed(todayIso, input.special.id),
  };
}

/**
 * eligible today -> score -> one per venue -> rank -> diversify -> cap.
 * Returns at most `limit` Specials (default 4), fewer when fewer are
 * eligible, [] when none are — callers hide the section entirely on [].
 */
export function selectTodaysSpecials(input: SelectTodaysSpecialsInput): WebsiteDailySpecialListItem[] {
  const { candidates, todayIso, overrides = [], limit = TODAYS_SPECIALS_DEFAULT_LIMIT } = input;

  const excludedIds = new Set(overrides.filter((o) => o.action === "exclude").map((o) => o.dailySpecialId));
  const overrideById = new Map(overrides.map((o) => [o.dailySpecialId, o]));

  // 1. Eligible today (reuses occursOnDate() — the exact same day/
  //    recurrence-boundary rule the /website-daily-specials?when=today
  //    results page filters against) and not excluded.
  const eligible = candidates.filter(
    (c) => occursOnDate(c.special.schedule, todayIso) && !excludedIds.has(c.special.id)
  );

  // 2. Score.
  const scored = eligible.map((c) => scoreCandidate(c, overrideById, todayIso));

  // 3. One per venue — an override-forced "include" always wins its
  //    venue's slot over a naturally-higher-ranked sibling Special at the
  //    same venue (mirrors Collections' manual-add-always-wins behavior,
  //    applied per-venue since one venue can have many Specials, unlike a
  //    Collection's one-row-per-venue overrides).
  const bestByVenue = new Map<string, ScoredCandidate>();
  for (const candidate of scored) {
    const venueId = candidate.special.venueId;
    const current = bestByVenue.get(venueId);
    if (!current) {
      bestByVenue.set(venueId, candidate);
      continue;
    }
    const candidateWins =
      candidate.forcedInclude !== current.forcedInclude
        ? candidate.forcedInclude
        : isHigherRanked(candidate, current);
    if (candidateWins) bestByVenue.set(venueId, candidate);
  }

  // 4. Rank venue-representatives.
  const ranked = [...bestByVenue.values()].sort((a, b) => (isHigherRanked(a, b) ? -1 : isHigherRanked(b, a) ? 1 : 0));

  // 5. Greedy diversity selection — among candidates within
  //    DIVERSITY_SCORE_BAND merit-score points of the current best
  //    remaining candidate, prefer whichever offer type is least
  //    represented among picks made so far. A soft preference: when no
  //    comparable alternative exists (e.g. only one candidate remains, or
  //    every remaining candidate is already the same type), the plain
  //    rank order wins — every available slot still gets filled.
  const selected: ScoredCandidate[] = [];
  const remaining = [...ranked];
  const typeCounts: Record<string, number> = {};

  while (selected.length < limit && remaining.length > 0) {
    const topScore = remaining[0].meritScore;
    const topBoost = remaining[0].overrideBoost;
    // Only candidates tied on override boost are eligible for the
    // diversity re-ranking below — a real founder boost must never be
    // skipped over merely to satisfy type variety.
    // remaining[0] always satisfies its own comparison (0 boost delta, 0
    // score delta), so this is never 0 — the comparable pool always
    // contains at least remaining[0] itself.
    const comparableEndIndex = remaining.findIndex(
      (c) => c.overrideBoost !== topBoost || topScore - c.meritScore > DIVERSITY_SCORE_BAND
    );
    const pool = comparableEndIndex === -1 ? remaining : remaining.slice(0, comparableEndIndex);

    let pickIndex = 0;
    let lowestCount = Infinity;
    pool.forEach((c, i) => {
      const count = typeCounts[c.special.offerType] ?? 0;
      if (count < lowestCount) {
        lowestCount = count;
        pickIndex = i;
      }
    });

    const picked = pool[pickIndex];
    remaining.splice(remaining.indexOf(picked), 1);
    selected.push(picked);
    typeCounts[picked.special.offerType] = (typeCounts[picked.special.offerType] ?? 0) + 1;
  }

  // Diversity affects WHICH four are chosen, never the display order — the
  // final set is always re-sorted back into rank order (override boost,
  // then merit score, then the deterministic tie-break) so a diverse pick
  // that was selected slightly out of turn still lands in its natural rank
  // position rather than wherever the greedy loop happened to pick it.
  selected.sort((a, b) => (isHigherRanked(a, b) ? -1 : isHigherRanked(b, a) ? 1 : 0));

  return selected.map((c) => c.special);
}
