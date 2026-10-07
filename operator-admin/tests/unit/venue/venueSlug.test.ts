import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBaseVenueSlug,
  pickAvailableVenueSlug,
  resolveAvailableVenueSlug,
} from "../../../src/lib/venueSlug";

/**
 * Public venue slugs for founder-approved operator submissions: name-based
 * (migration 066 convention), never submission-{id} / submission-{placeId},
 * and never reusing a current, historical (venue_slug_history) or reserved
 * slug.
 */

type Rows = Record<string, Record<string, string>[]>;

/** Minimal fake of the two .from(table).select(col).or(filter) reads the resolver makes. */
function fakeSupabase(rows: Rows, errorTable?: string) {
  const filters: Record<string, string> = {};
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            or(filter: string) {
              filters[table] = filter;
              if (table === errorTable) return Promise.resolve({ data: null, error: { message: "boom" } });
              return Promise.resolve({ data: rows[table] ?? [], error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, filters };
}

test("base: plain venue name", () => {
  assert.equal(buildBaseVenueSlug("SpearHead Winery", "Kelowna"), "spearhead-winery");
  assert.equal(buildBaseVenueSlug("Perch Sky Lounge", "Kelowna"), "perch-sky-lounge");
});

test("base: redundant trailing city is dropped", () => {
  assert.equal(
    buildBaseVenueSlug("The Placery at Hyatt Place Kelowna", "Kelowna"),
    "the-placery-at-hyatt-place"
  );
  assert.equal(buildBaseVenueSlug("Original Joe's West Kelowna", "West Kelowna"), "original-joes");
});

test("base: geography that is part of the name is kept", () => {
  // Leading city is part of the brand, not a redundant suffix.
  assert.equal(buildBaseVenueSlug("Kelowna Brewing Company", "Kelowna"), "kelowna-brewing-company");
  // A different place name ending in the city.
  assert.equal(buildBaseVenueSlug("Taphouse West Kelowna", "Kelowna"), "taphouse-west-kelowna");
  // Stripping would leave a single generic word.
  assert.equal(buildBaseVenueSlug("Hotel Kelowna", "Kelowna"), "hotel-kelowna");
  // Region words that aren't the city are untouched.
  assert.equal(
    buildBaseVenueSlug("Table 19 at The Okanagan Golf Club", "Kelowna"),
    "table-19-at-the-okanagan-golf-club"
  );
  // Partial token match ("kelownas") is not the city.
  assert.equal(buildBaseVenueSlug("Best of Kelownas", "Kelowna"), "best-of-kelownas");
});

test("base: apostrophes dropped like migration 066 (original-joes, kelly-obryans)", () => {
  assert.equal(buildBaseVenueSlug("Kelly O'Bryan's", "Kelowna"), "kelly-obryans");
  assert.equal(buildBaseVenueSlug("Kelowna’s Best Patio", "Kelowna"), "kelownas-best-patio");
});

test("base: no city, empty or symbol-only names", () => {
  assert.equal(buildBaseVenueSlug("SpearHead Winery", null), "spearhead-winery");
  assert.equal(buildBaseVenueSlug("!!!", "Kelowna"), "venue");
});

test("pick: deterministic order — base, base-city, then -2, -3", () => {
  assert.equal(pickAvailableVenueSlug("perch-sky-lounge", "Kelowna", new Set()), "perch-sky-lounge");
  assert.equal(
    pickAvailableVenueSlug("perch-sky-lounge", "Kelowna", new Set(["perch-sky-lounge"])),
    "perch-sky-lounge-kelowna"
  );
  assert.equal(
    pickAvailableVenueSlug("perch-sky-lounge", "Kelowna", new Set(["perch-sky-lounge", "perch-sky-lounge-kelowna"])),
    "perch-sky-lounge-2"
  );
  assert.equal(
    pickAvailableVenueSlug(
      "perch-sky-lounge",
      "Kelowna",
      new Set(["perch-sky-lounge", "perch-sky-lounge-kelowna", "perch-sky-lounge-2"])
    ),
    "perch-sky-lounge-3"
  );
  // Same inputs → same output, every time.
  const taken = new Set(["perch-sky-lounge"]);
  assert.equal(
    pickAvailableVenueSlug("perch-sky-lounge", "Kelowna", taken),
    pickAvailableVenueSlug("perch-sky-lounge", "Kelowna", taken)
  );
});

test("pick: reserved slug is never returned", () => {
  assert.equal(pickAvailableVenueSlug("events", "Kelowna", new Set()), "events-kelowna");
  assert.equal(pickAvailableVenueSlug("events", null, new Set()), "events-2");
});

test("resolve: current-slug collision", async () => {
  const { client } = fakeSupabase({ venues: [{ slug: "spearhead-winery" }] });
  assert.equal(
    await resolveAvailableVenueSlug(client, { name: "SpearHead Winery", cityName: "Kelowna" }),
    "spearhead-winery-kelowna"
  );
});

test("resolve: historical-slug collision — never takes over an old redirect URL", async () => {
  const { client, filters } = fakeSupabase({ venue_slug_history: [{ old_slug: "spearhead-winery" }] });
  assert.equal(
    await resolveAvailableVenueSlug(client, { name: "SpearHead Winery", cityName: "Kelowna" }),
    "spearhead-winery-kelowna"
  );
  assert.equal(filters.venue_slug_history, "old_slug.eq.spearhead-winery,old_slug.like.spearhead-winery-%");
  assert.equal(filters.venues, "slug.eq.spearhead-winery,slug.like.spearhead-winery-%");
});

test("resolve: lookup failure throws instead of using an unchecked slug", async () => {
  for (const table of ["venues", "venue_slug_history"]) {
    const { client } = fakeSupabase({}, table);
    await assert.rejects(resolveAvailableVenueSlug(client, { name: "SpearHead Winery", cityName: "Kelowna" }));
  }
});

test("resolve: approved cleanup names (no collisions) yield expected slugs", async () => {
  const { client } = fakeSupabase({});
  const resolve = (name: string) => resolveAvailableVenueSlug(client, { name, cityName: "Kelowna" });
  assert.equal(await resolve("SpearHead Winery"), "spearhead-winery");
  assert.equal(await resolve("Perch Sky Lounge"), "perch-sky-lounge");
  assert.equal(await resolve("The Placery at Hyatt Place Kelowna"), "the-placery-at-hyatt-place");
});

test("approval action: name-based helper, no submission-* slug from submission id or Place ID", () => {
  const src = readFileSync(
    join(__dirname, "../../../src/app/control-panel/operator-submissions/[id]/actions.ts"),
    "utf8"
  );
  assert.match(src, /resolveAvailableVenueSlug\(supabase, \{ name: venueName, cityName: resolvedCity \}\)/);
  assert.doesNotMatch(src, /`submission-\$\{/);
  assert.doesNotMatch(src, /slugBase/);
  assert.doesNotMatch(src, /placeId\.toLowerCase\(\)/);
  assert.doesNotMatch(src, /submissionId\.toLowerCase\(\)/);
});
