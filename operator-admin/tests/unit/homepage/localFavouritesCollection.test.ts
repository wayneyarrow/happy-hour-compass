import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocalFavourites, getRailVenuesByKey, type MarketConfig } from "../../../src/lib/discover/discoverEngine";
import { isManualVenueAddEligible, isManualEventAddEligible } from "../../../src/lib/data/collectionsPreview";
import {
  ALGORITHM_COLLECTION_TYPE,
  algorithmRequiresVerifiedVenues,
  validateAlgorithmKey,
} from "../../../src/lib/data/collectionsShared";
import {
  canMoveResolvedItem,
  hasOrderingOverrides,
  moveResolvedItem,
  orderAlgorithmicItems,
  resetOrderingOverrides,
} from "../../../src/lib/data/collectionOrdering";
import type { ConsumerVenue } from "../../../src/lib/data/venues";

/**
 * "Explore These Local Favourites" — the local-favourites algorithm, its
 * verified-only manual-add rule, the Discover-exclusion gate on manual adds
 * (all algorithmic Collections), and the corrected Move Up/Down ordering.
 */

const ANYWHERE: MarketConfig = { lat: 0, lng: 0, radiusKm: Number.MAX_SAFE_INTEGER };

function venue(id: string, overrides: Partial<ConsumerVenue> = {}): ConsumerVenue {
  return {
    id,
    venueUuid: `uuid-${id}`,
    name: id,
    latitude: null,
    longitude: null,
    isVerified: true,
    excludeFromDiscover: false,
    internalBoost: 0,
    googleRating: 4.0,
    operatorPlan: "free",
    ...overrides,
  } as unknown as ConsumerVenue;
}

// ── Algorithm ────────────────────────────────────────────────────────────────

test("local-favourites: verified, Discover-eligible venues only", () => {
  const result = getLocalFavourites(
    [venue("a"), venue("unverified", { isVerified: false }), venue("excluded", { excludeFromDiscover: true })],
    [],
    ANYWHERE
  );
  assert.deepEqual(result.map((v) => v.id), ["a"]);
});

test("local-favourites: ordered by discover score, so an effective Premium plan outranks a higher rating", () => {
  const result = getLocalFavourites(
    [
      venue("free-5", { googleRating: 5.0 }),
      venue("premium-4.3", { googleRating: 4.3, operatorPlan: "premium" }),
      venue("boosted", { googleRating: 4.4, internalBoost: 10 }),
    ],
    [],
    ANYWHERE
  );
  assert.deepEqual(result.map((v) => v.id), ["premium-4.3", "boosted", "free-5"]);
});

test("local-favourites: an include override never brings in an unverified venue; exclude removes", () => {
  const result = getLocalFavourites(
    [venue("a"), venue("b"), venue("unverified", { isVerified: false })],
    [
      { venueUuid: "uuid-unverified", action: "include" },
      { venueUuid: "uuid-b", action: "exclude" },
    ],
    ANYWHERE
  );
  assert.deepEqual(result.map((v) => v.id), ["a"]);
});

test("local-favourites: dispatched by key, a venue Collection algorithm, and verified-only", () => {
  assert.deepEqual(getRailVenuesByKey("local-favourites", [venue("a")], [], ANYWHERE).map((v) => v.id), ["a"]);
  assert.equal(ALGORITHM_COLLECTION_TYPE["local-favourites"], "venue");
  assert.equal(validateAlgorithmKey("local-favourites", "venue"), null);
  assert.notEqual(validateAlgorithmKey("local-favourites", "event"), null);
  assert.equal(algorithmRequiresVerifiedVenues("local-favourites"), true);
  for (const key of ["spotlight", "patio-picks", "highly-rated", "featured-nearby", "new-this-week", null]) {
    assert.equal(algorithmRequiresVerifiedVenues(key), false, String(key));
  }
});

// ── Manual-add eligibility ───────────────────────────────────────────────────

test("manual venue add: Discover exclusion applies to every algorithm", () => {
  const excluded = venue("x", { excludeFromDiscover: true });
  for (const key of ["patio-picks", "highly-rated", "spotlight", "featured-nearby", "new-this-week", "local-favourites"] as const) {
    assert.equal(isManualVenueAddEligible(excluded, key), false, key);
  }
});

test("manual venue add: verification required only for local-favourites", () => {
  const unverified = venue("u", { isVerified: false });
  assert.equal(isManualVenueAddEligible(unverified, "local-favourites"), false);
  assert.equal(isManualVenueAddEligible(unverified, "patio-picks"), true);
  assert.equal(isManualVenueAddEligible(venue("v"), "local-favourites"), true);
});

test("manual event add: venue-wide and event-level Discover exclusions both apply", () => {
  assert.equal(isManualEventAddEligible({ excludeFromDiscover: false, venueExcludeFromDiscover: false }), true);
  assert.equal(isManualEventAddEligible({ excludeFromDiscover: false, venueExcludeFromDiscover: true }), false);
  assert.equal(isManualEventAddEligible({ excludeFromDiscover: true, venueExcludeFromDiscover: false }), false);
});

// ── Ordering precedence ──────────────────────────────────────────────────────

const idOf = (id: string) => id;
const order = (algorithmIds: string[], rows: { id: string; action: "include" | "exclude"; boost: number }[]) =>
  orderAlgorithmicItems(
    algorithmIds,
    idOf,
    rows.filter((r) => r.action === "include").map((r) => ({ id: r.id, boost: r.boost }))
  ).map((x) => x.item);

test("precedence: boost, then stored position, then algorithm order", () => {
  const result = order(
    ["a", "b", "c", "d", "e"],
    [
      { id: "e", action: "include", boost: 0 },
      { id: "c", action: "include", boost: 0 },
      { id: "d", action: "include", boost: 50 },
    ]
  );
  assert.deepEqual(result, ["d", "e", "c", "a", "b"]);
});

// ── Move Up / Move Down ──────────────────────────────────────────────────────

type Row = { id: string; action: "include" | "exclude"; boost: number; tag?: string };
const promote = (id: string): Row => ({ id, action: "include", boost: 0, tag: "promoted" });

test("Move Up on #5 moves it exactly one place (the old swap lifted both rows to the top)", () => {
  const algorithm = ["a", "b", "c", "d", "e", "f"];
  const before = order(algorithm, []);
  const rows = moveResolvedItem(before, [] as Row[], 4, -1, promote)!;
  assert.deepEqual(order(algorithm, rows), ["a", "b", "c", "e", "d", "f"]);
  // Then Move Down on the same item restores the original order.
  const again = moveResolvedItem(order(algorithm, rows), rows, 3, 1, promote)!;
  assert.deepEqual(order(algorithm, again), algorithm);
});

test("Move never crosses a Boost boundary and keeps existing rows (manual adds, boosts) intact", () => {
  const algorithm = ["a", "b", "c", "m"];
  const rows: Row[] = [
    { id: "b", action: "include", boost: 50 },
    { id: "m", action: "include", boost: 0, tag: "manual-add" },
    { id: "z", action: "exclude", boost: 0 },
  ];
  const resolved = order(algorithm, rows); // b (boost) → m (positioned) → a → c
  assert.deepEqual(resolved, ["b", "m", "a", "c"]);
  assert.equal(canMoveResolvedItem(resolved, (id) => rows.find((r) => r.id === id)?.boost ?? 0, 1, -1), false);
  assert.equal(moveResolvedItem(resolved, rows, 1, -1, promote), null);

  const moved = moveResolvedItem(resolved, rows, 3, -1, promote)!;
  assert.deepEqual(order(algorithm, moved), ["b", "m", "c", "a"]);
  assert.equal(moved.find((r) => r.id === "m")?.tag, "manual-add");
  assert.equal(moved.find((r) => r.id === "b")?.boost, 50);
  assert.ok(moved.some((r) => r.id === "z" && r.action === "exclude"));
});

test("randomized: every allowed move is exactly one position; nothing else moves", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 400; trial++) {
    const ids = Array.from({ length: 3 + Math.floor(rand() * 10) }, (_, i) => `v${i}`);
    const algorithm = [...ids].sort(() => rand() - 0.5);
    let rows: Row[] = ids
      .filter(() => rand() < 0.4)
      .map((id) => ({ id, action: "include" as const, boost: [0, 0, 0, 20, 50][Math.floor(rand() * 5)] }))
      .sort(() => rand() - 0.5);

    for (let step = 0; step < 6; step++) {
      const resolved = order(algorithm, rows);
      const index = Math.floor(rand() * resolved.length);
      const direction = rand() < 0.5 ? -1 : 1;
      const next = moveResolvedItem(resolved, rows, index, direction, promote);
      const target = index + direction;
      if (!next) {
        const boostOf = (id: string) => rows.find((r) => r.id === id)?.boost ?? 0;
        assert.ok(target < 0 || target >= resolved.length || boostOf(resolved[index]) !== boostOf(resolved[target]));
        continue;
      }
      const expected = [...resolved];
      [expected[index], expected[target]] = [expected[target], expected[index]];
      assert.deepEqual(order(algorithm, next), expected, `trial ${trial} step ${step}`);
      for (const r of rows) assert.equal(next.find((n) => n.id === r.id)?.boost, r.boost);
      rows = next;
    }
  }
});

// ── Reset ordering overrides ─────────────────────────────────────────────────

const isManual = (r: Row) => r.tag === "manual-add";

test("reset: clears algorithm items' positions and Boosts; keeps manual additions (Boost 0) and exclusions", () => {
  const algorithm = ["a", "b", "c", "d", "e"];
  const rows: Row[] = [
    { id: "d", action: "include", boost: 40 },
    { id: "c", action: "include", boost: 0 },
    { id: "m1", action: "include", boost: 70, tag: "manual-add" },
    { id: "m2", action: "include", boost: 0, tag: "manual-add" },
    { id: "b", action: "exclude", boost: 0 },
    { id: "mx", action: "exclude", boost: 0, tag: "manual-add" },
  ];
  assert.equal(hasOrderingOverrides(rows, isManual), true);
  const reset = resetOrderingOverrides(rows, isManual);
  assert.deepEqual(reset, [
    { id: "m1", action: "include", boost: 0, tag: "manual-add" },
    { id: "m2", action: "include", boost: 0, tag: "manual-add" },
    { id: "b", action: "exclude", boost: 0 },
    { id: "mx", action: "exclude", boost: 0, tag: "manual-add" },
  ]);
  assert.equal(hasOrderingOverrides(reset, isManual), false);
  // Manual additions keep their default placement above the algorithm order,
  // which is restored for everything else (b stays excluded upstream).
  assert.deepEqual(order([...algorithm.filter((id) => id !== "b"), "m1", "m2"], reset), ["m1", "m2", "a", "c", "d", "e"]);
  assert.equal(rows[0].boost, 40, "input rows untouched (editor state only until Save)");
});

test("reset after moves restores the exact algorithm order", () => {
  const algorithm = ["a", "b", "c", "d", "e", "f"];
  let rows: Row[] = [];
  for (const [index, dir] of [[5, -1], [4, -1], [1, 1]] as const) {
    rows = moveResolvedItem(order(algorithm, rows), rows, index, dir, promote)!;
  }
  assert.notDeepEqual(order(algorithm, rows), algorithm);
  assert.deepEqual(order(algorithm, resetOrderingOverrides(rows, isManual)), algorithm);
  assert.equal(hasOrderingOverrides([], isManual), false);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

const root = join(__dirname, "../../..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

test("wiring: verified-only enforced in Add search and both save paths; editor uses the shared move", () => {
  const actions = src("src/app/control-panel/collections/actions.ts");
  assert.match(actions, /algorithmRequiresVerifiedVenues\(input\.algorithmKey/);
  assert.match(actions, /validateVerifiedManualAdds\(\s*collectionId/);
  const data = src("src/lib/data/collections.ts");
  assert.equal((data.match(/await validateVerifiedManualAdds\(/g) ?? []).length, 2);
  const table = src("src/app/control-panel/collections/ResolvedCollectionTable.tsx");
  assert.match(table, /moveResolvedItem\(/);
  assert.match(table, /algorithmKey \}\)/);
  assert.match(table, /resetOrderingOverrides\(overrideRows/);
  assert.match(table, /window\.confirm\(/);
});
