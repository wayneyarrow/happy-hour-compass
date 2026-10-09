import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Comp / Trial Part 1 — public readers, end to end, against a stubbed
 * PostgREST (globalThis.fetch). Proves the real reader functions:
 *   - enforce a grant recipient's limits from the embedded grant data;
 *   - leave venues with no grants exactly as before;
 *   - on a FAILED read (PostgREST error, or a row missing the grant embed)
 *     return their normal error result — never a grant recipient's paused
 *     content.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://postgrest.test";
process.env.SUPABASE_SECRET_KEY = "test-secret";

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const OWNER = "11111111-1111-1111-1111-111111111111";
const CLAIMED = "2026-09-01T00:00:00.000Z";

/** An expired Premium Trial — the venue is a grant recipient on Free billing. */
const EXPIRED_TRIAL = {
  id: "g-1", venue_id: "v-recipient", plan_code: "premium", grant_type: "trial",
  starts_at: iso(NOW - 40 * DAY), ends_at: iso(NOW - 10 * DAY), reason: "trial",
  operator_id: OWNER, owner_claimed_at: CLAIMED, created_by_email: "f@x", created_at: iso(NOW - 40 * DAY),
  revoked_at: null, end_reason: null, revoked_by_email: null, revoke_reason: null,
};

function planCtx(grants: unknown[]) {
  return {
    plan_ctx_operator_id: OWNER,
    plan_ctx_claimed_at: CLAIMED,
    plan_ctx_subscription: null,
    plan_ctx_grants: grants,
  };
}

type Route = (url: URL) => { status: number; body: unknown } | undefined;
let route: Route = () => undefined;
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const hit = route(url) ?? { status: 200, body: [] };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  route = () => undefined;
});

const table = (url: URL) => url.pathname.replace("/rest/v1/", "");

function eventRow(id: string, venueCtx: unknown, recurrence = "weekly") {
  return {
    id, slug: id, venue_id: "v", title: id, description: null, event_type: null, image_url: null,
    first_date: null, start_time: null, end_time: null, recurrence, event_time: null, event_frequency: null,
    is_seeded_event: false,
    venues: { name: "V", lat: null, lng: null, establishment_type: "Bar", market_geo: null, city_geo: null, ...(venueCtx as object) },
  };
}

test("events search: recipient's recurring event is excluded, other venues untouched, select carries the grant embed", async () => {
  const { getPublishedEventsForWebsite } = await import("@/lib/data/events");
  const { MARKETS } = await import("@/lib/markets");
  let select = "";
  route = (url) => {
    if (table(url) !== "events") return undefined;
    select = url.searchParams.get("select") ?? "";
    return {
      status: 200,
      body: [
        eventRow("recipient-weekly", planCtx([EXPIRED_TRIAL])),
        eventRow("recipient-oneoff", planCtx([EXPIRED_TRIAL]), "none"),
        eventRow("other-weekly", planCtx([])),
      ],
    };
  };
  const events = await getPublishedEventsForWebsite(MARKETS[0]);
  assert.deepEqual(events.map((e) => e.id).sort(), ["other-weekly", "recipient-oneoff"]);
  assert.match(select, /plan_ctx_grants:venue_plan_grants!venue_plan_grants_venue_id_fkey\(/);
});

test("FAILURE: events search returns [] (its normal error result) when the query fails", async () => {
  const { getPublishedEventsForWebsite } = await import("@/lib/data/events");
  const { MARKETS } = await import("@/lib/markets");
  route = (url) => (table(url) === "events" ? { status: 400, body: { code: "PGRST200", message: "Could not find a relationship" } } : undefined);
  assert.deepEqual(await getPublishedEventsForWebsite(MARKETS[0]), []);
});

test("FAILURE: events search returns [] — not the recipient's paused event — when rows lack the grant embed", async () => {
  const { getPublishedEventsForWebsite } = await import("@/lib/data/events");
  const { MARKETS } = await import("@/lib/markets");
  route = (url) =>
    table(url) === "events"
      ? { status: 200, body: [eventRow("recipient-weekly", { plan_ctx_operator_id: OWNER, plan_ctx_claimed_at: CLAIMED, plan_ctx_subscription: null })] }
      : undefined;
  assert.deepEqual(await getPublishedEventsForWebsite(MARKETS[0]), []);
});

function venueRow(id: string, ctx: unknown) {
  return {
    id, slug: id, name: id, address_line1: "", city: "Kelowna", phone: "", website_url: "", menu_url: "",
    lat: null, lng: null, payment_types: null, hh_times: null, hh_tagline: "",
    hh_food_details: JSON.stringify(["A", "B", "C", "D", "E"]),
    hh_drink_details: JSON.stringify(["1", "2", "3", "4"]),
    business_hours: null, establishment_type: "Bar", placeholder_image_path: null, is_verified: false,
    google_rating: null, google_review_count: null, search_tags: ["patio", "wings"], seeded_tags: [],
    created_at: "", updated_at: "", internal_boost: 0, spotlight_eligible: false, exclude_from_discover: false,
    venue_subscriptions: null, market_geo: null, city_geo: null,
    ...(ctx as object),
  };
}

test("venue list: recipient limited to Free (3 food, 3 drinks, no tags); non-recipient unchanged", async () => {
  const { getPublishedVenuesForConsumer } = await import("@/lib/data/venues");
  route = (url) =>
    table(url) === "venues"
      ? { status: 200, body: [venueRow("recipient", planCtx([EXPIRED_TRIAL])), venueRow("other", planCtx([]))] }
      : undefined;
  const venues = await getPublishedVenuesForConsumer();
  const byId = new Map(venues.map((v) => [v.id, v]));
  assert.equal(byId.get("recipient")!.specialsFood.length, 3);
  assert.equal(byId.get("recipient")!.specialsDrinks.length, 3);
  assert.deepEqual(byId.get("recipient")!.searchTags, []);
  assert.equal(byId.get("other")!.specialsFood.length, 5);
  assert.deepEqual(byId.get("other")!.searchTags, ["patio", "wings"]);
});

test("FAILURE: venue list returns [] when venue rows lack the grant embed (never the unrestricted list)", async () => {
  const { getPublishedVenuesForConsumer } = await import("@/lib/data/venues");
  route = (url) => (table(url) === "venues" ? { status: 200, body: [venueRow("recipient", {})] } : undefined);
  assert.deepEqual(await getPublishedVenuesForConsumer(), []);
});

test("Daily Specials for a venue: recipient's weekly special paused; FAILURE with no embed → []", async () => {
  const { getPublishedDailySpecialsForVenue } = await import("@/lib/data/dailySpecials");
  const special = (id: string, schedule: "weekly" | "one_time") => ({
    id, venue_id: "v-recipient", created_by_operator_id: OWNER, updated_by_operator_id: null,
    created_at: iso(NOW), updated_at: iso(NOW), title: id, offer_type: "food", short_summary: null,
    description: null, conditions: null, image_url: null, schedule_type: schedule,
    one_time_date: schedule === "one_time" ? iso(NOW + DAY).slice(0, 10) : null,
    days_of_week: schedule === "weekly" ? [1] : null, recurrence_start_date: null, recurrence_end_date: null,
    time_mode: "all_day", start_time: null, end_mode: null, end_time: null,
    is_published: true, is_seeded_special: false, source_url: null, last_verified_at: null,
  });
  route = (url) =>
    table(url) === "daily_specials"
      ? { status: 200, body: [{ ...special("weekly", "weekly"), venues: planCtx([EXPIRED_TRIAL]) }, { ...special("once", "one_time"), venues: planCtx([EXPIRED_TRIAL]) }] }
      : undefined;
  const list = await getPublishedDailySpecialsForVenue("v-recipient");
  assert.deepEqual(list.map((s) => s.id), ["once"]);

  route = (url) => (table(url) === "daily_specials" ? { status: 200, body: [{ ...special("weekly", "weekly"), venues: {} }] } : undefined);
  assert.deepEqual(await getPublishedDailySpecialsForVenue("v-recipient"), []);
});
