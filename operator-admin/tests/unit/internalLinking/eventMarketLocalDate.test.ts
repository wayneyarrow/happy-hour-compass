import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Event upcoming/past eligibility uses the event's market-local date, never
 * the server's UTC date. Every public reader that applies the date-only rule
 * is exercised end to end against a stubbed PostgREST (globalThis.fetch) at
 * controlled instants (mock.timers, Date only):
 *   - getPublishedEventsForWebsite  — Events results, homepage event suggestions
 *   - getEventsForConsumerVenues    — venue page Upcoming Events
 *   - getPublishedEventsForConsumer — sitemap
 *   - getCPFeaturedEventCandidates  — Featured Events rail / event Collections
 *   - getEventForWebsiteBySlug      — event page "has passed" state + More Events
 *
 * The rule itself is unchanged: a one-off event is eligible through the end
 * of its first_date; recurring events always are.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://postgrest.test";
process.env.SUPABASE_SECRET_KEY = "test-secret";

// Wed 2026-10-28, 6 PM PDT (UTC-7) — UTC is already Thursday the 29th.
const PDT_6PM = "2026-10-29T01:00:00.000Z";
// Thu 2026-10-29, 00:00 PDT — Pacific midnight.
const PDT_MIDNIGHT = "2026-10-29T07:00:00.000Z";
// Fri 2026-12-04, 6 PM PST (UTC-8) — UTC is already Saturday the 5th.
const PST_6PM = "2026-12-05T02:00:00.000Z";
// Sat 2026-12-05, 00:00 PST.
const PST_MIDNIGHT = "2026-12-05T08:00:00.000Z";

const NO_PLAN_CTX = {
  plan_ctx_operator_id: null,
  plan_ctx_claimed_at: null,
  plan_ctx_subscription: null,
  plan_ctx_grants: [],
};

function venueEmbed(marketSlug: string | null, extra: object = {}) {
  return {
    id: "v", slug: "v", name: "V", is_published: true, lat: null, lng: null,
    establishment_type: "Bar", exclude_from_discover: false, venue_subscriptions: null,
    market_geo: marketSlug ? { slug: marketSlug } : null, city_geo: { slug: "kelowna" },
    ...NO_PLAN_CTX, ...extra,
  };
}

function eventRow(id: string, firstDate: string | null, recurrence: string, marketSlug: string | null = "central-okanagan", venueExtra: object = {}) {
  return {
    id, slug: id, venue_id: "v", title: id, description: null, event_type: null, image_url: null,
    first_date: firstDate, start_time: null, end_time: null, recurrence, event_time: null, event_frequency: null,
    is_seeded_event: false, updated_at: "2026-10-01T00:00:00Z", internal_boost: 0, exclude_from_discover: false,
    ticketing_enabled: false, ticket_url: null, sold_out: false, price_display: null, age_restriction: null,
    reservation_recommendation: null, parking_notes: null, accessibility_notes: null,
    venues: venueEmbed(marketSlug, venueExtra),
  };
}

let eventsBody: unknown[] = [];
const requests: URL[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    const accept = new Headers(init?.headers).get("accept") ?? "";
    const table = url.pathname.replace("/rest/v1/", "");
    let body: unknown = [];
    if (table === "events") {
      // A single-event lookup filters by slug; the venue's "other events" list by venue_id.
      const slug = url.searchParams.get("slug")?.replace(/^eq\./, "");
      body = slug ? eventsBody.filter((e) => (e as { slug: string }).slug === slug) : eventsBody;
    } else if (table === "venues") {
      body = [{ ...venueEmbed("central-okanagan"), address_line1: null }];
    }
    if (accept.includes("vnd.pgrst.object") && Array.isArray(body)) body = body[0] ?? null;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

const at = (iso: string) => mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
const eventsSelects = () => requests.filter((u) => u.pathname.endsWith("/events")).map((u) => u.searchParams.get("select") ?? "");

const SAME_DAY_FIXTURE = () => [
  eventRow("today-oneoff", "2026-10-28", "none"),
  eventRow("yesterday-oneoff", "2026-10-27", "none"),
  eventRow("weekly-old-start", "2026-03-10", "weekly"),
  eventRow("tomorrow-oneoff", "2026-10-29", "none"),
];

async function readers() {
  const events = await import("@/lib/data/events");
  const { MARKETS } = await import("@/lib/markets");
  const coMarket = MARKETS.find((m) => m.id === "central-okanagan")!;
  return {
    website: async () => (await events.getPublishedEventsForWebsite(coMarket)).map((e) => e.id).sort(),
    venue: async () => (await events.getEventsForConsumerVenues(["v"])).map((e) => e.id).sort(),
    sitemap: async () => (await events.getPublishedEventsForConsumer()).map((e) => e.id).sort(),
    featured: async () => (await events.getCPFeaturedEventCandidates()).map((e) => e.eventUuid).sort(),
  };
}

// ── Pure helper ──────────────────────────────────────────────────────────────

test("eventLocalToday: 6 PM PDT is still the Pacific day although UTC is tomorrow", async () => {
  const { eventLocalToday } = await import("@/lib/data/events");
  assert.equal(new Date(PDT_6PM).toISOString().slice(0, 10), "2026-10-29");
  assert.equal(eventLocalToday(venueEmbed("central-okanagan"), new Date(PDT_6PM)), "2026-10-28");
  assert.equal(eventLocalToday(venueEmbed("central-okanagan"), new Date(PDT_MIDNIGHT)), "2026-10-29");
});

test("eventLocalToday: standard time (PST) boundaries", async () => {
  const { eventLocalToday } = await import("@/lib/data/events");
  assert.equal(eventLocalToday(venueEmbed("central-okanagan"), new Date(PST_6PM)), "2026-12-04");
  assert.equal(eventLocalToday(venueEmbed("central-okanagan"), new Date(PST_MIDNIGHT)), "2026-12-05");
});

test("eventLocalToday: Calgary uses Mountain time, not Pacific", async () => {
  const { eventLocalToday } = await import("@/lib/data/events");
  const instant = new Date("2026-10-29T06:30:00.000Z"); // 00:30 MDT Oct 29, 23:30 PDT Oct 28
  assert.equal(eventLocalToday(venueEmbed("calgary"), instant), "2026-10-29");
  assert.equal(eventLocalToday(venueEmbed("central-okanagan"), instant), "2026-10-28");
});

test("eventLocalToday: array embeds, and a missing market uses the fallback market, then the default timezone", async () => {
  const { eventLocalToday } = await import("@/lib/data/events");
  const instant = new Date("2026-10-29T06:30:00.000Z");
  assert.equal(eventLocalToday([venueEmbed("calgary")], instant), "2026-10-29");
  assert.equal(eventLocalToday(venueEmbed(null), instant, "calgary"), "2026-10-29");
  assert.equal(eventLocalToday(venueEmbed(null), instant), "2026-10-28"); // America/Vancouver default
  assert.equal(eventLocalToday(null, instant), "2026-10-28");
});

// ── Every list reader, across both boundaries ────────────────────────────────

for (const [label, sixPm, midnight, today, yesterday, tomorrow] of [
  ["PDT", PDT_6PM, PDT_MIDNIGHT, "2026-10-28", "2026-10-27", "2026-10-29"],
  ["PST", PST_6PM, PST_MIDNIGHT, "2026-12-04", "2026-12-03", "2026-12-05"],
] as const) {
  const fixture = () => [
    eventRow("today-oneoff", today, "none"),
    eventRow("yesterday-oneoff", yesterday, "none"),
    eventRow("weekly-old-start", "2026-03-10", "weekly"),
    eventRow("tomorrow-oneoff", tomorrow, "none"),
  ];

  test(`${label} 6 PM: today's one-off event stays eligible on every reader; yesterday's is excluded; weekly always shows`, async () => {
    const r = await readers();
    eventsBody = fixture();
    at(sixPm);
    const expected = ["today-oneoff", "tomorrow-oneoff", "weekly-old-start"];
    assert.deepEqual(await r.website(), expected, "Events results");
    assert.deepEqual(await r.venue(), expected, "venue Upcoming Events");
    assert.deepEqual(await r.sitemap(), expected, "sitemap");
    assert.deepEqual(await r.featured(), expected, "Featured Events / Collections");
  });

  test(`${label} midnight: the previous day's one-off event becomes ineligible on every reader`, async () => {
    const r = await readers();
    eventsBody = fixture();
    at(midnight);
    const expected = ["tomorrow-oneoff", "weekly-old-start"];
    assert.deepEqual(await r.website(), expected, "Events results");
    assert.deepEqual(await r.venue(), expected, "venue Upcoming Events");
    assert.deepEqual(await r.sitemap(), expected, "sitemap");
    assert.deepEqual(await r.featured(), expected, "Featured Events / Collections");
  });
}

test("sitemap reader keeps upcoming events sorted soonest first with today's event leading", async () => {
  const { getPublishedEventsForConsumer } = await import("@/lib/data/events");
  eventsBody = SAME_DAY_FIXTURE();
  at(PDT_6PM);
  const ids = (await getPublishedEventsForConsumer()).map((e) => e.id);
  assert.deepEqual(ids, ["weekly-old-start", "today-oneoff", "tomorrow-oneoff"]);
});

test("each event is judged in its own market's timezone (Calgary vs Central Okanagan)", async () => {
  const { getEventsForConsumerVenues, getPublishedEventsForConsumer, getCPFeaturedEventCandidates } = await import("@/lib/data/events");
  eventsBody = [
    eventRow("co-oct28", "2026-10-28", "none", "central-okanagan"),
    eventRow("yyc-oct28", "2026-10-28", "none", "calgary"),
  ];
  at("2026-10-29T06:30:00.000Z"); // 23:30 PDT Oct 28 / 00:30 MDT Oct 29
  assert.deepEqual((await getEventsForConsumerVenues(["v"])).map((e) => e.id), ["co-oct28"]);
  assert.deepEqual((await getPublishedEventsForConsumer()).map((e) => e.id), ["co-oct28"]);
  assert.deepEqual((await getCPFeaturedEventCandidates()).map((e) => e.eventUuid), ["co-oct28"]);
});

test("website search falls back to the active market's timezone for a venue with no market", async () => {
  const { getPublishedEventsForWebsite } = await import("@/lib/data/events");
  const { MARKETS } = await import("@/lib/markets");
  eventsBody = [eventRow("no-market-oct28", "2026-10-28", "none", null)];
  at("2026-10-29T06:30:00.000Z");
  const calgary = MARKETS.find((m) => m.id === "calgary")!;
  const co = MARKETS.find((m) => m.id === "central-okanagan")!;
  assert.deepEqual((await getPublishedEventsForWebsite(calgary)).map((e) => e.id), []);
  assert.deepEqual((await getPublishedEventsForWebsite(co)).map((e) => e.id), ["no-market-oct28"]);
});

// ── Unchanged exclusions ─────────────────────────────────────────────────────

test("published-only filter, venue market embed and unpublished-venue exclusion are preserved", async () => {
  const r = await readers();
  eventsBody = [
    eventRow("today-oneoff", "2026-10-28", "none"),
    eventRow("unpublished-venue-today", "2026-10-28", "none", "central-okanagan", { is_published: false }),
  ];
  at(PDT_6PM);
  assert.deepEqual(await r.website(), ["today-oneoff"]);
  await r.venue();
  await r.sitemap();
  await r.featured();
  const eventReqs = requests.filter((u) => u.pathname.endsWith("/events"));
  assert.ok(eventReqs.length >= 4);
  for (const u of eventReqs) assert.equal(u.searchParams.get("is_published"), "eq.true");
  for (const s of eventsSelects()) assert.match(s, /market_geo:markets!market_id\(slug\)/);
});

// ── Event detail page ────────────────────────────────────────────────────────

test("event page: today's event is not 'passed' at 6 PM PDT, becomes passed at Pacific midnight; More Events follows the same date", async () => {
  const { getEventForWebsiteBySlug } = await import("@/lib/data/events");
  eventsBody = SAME_DAY_FIXTURE();

  at(PDT_6PM);
  const evening = await getEventForWebsiteBySlug("today-oneoff");
  assert.ok(evening, "event resolves");
  assert.equal(evening.isExpired, false);
  const moreTonight = evening.otherEvents.map((e) => e.id).sort();
  assert.ok(!moreTonight.includes("yesterday-oneoff"));
  assert.ok(moreTonight.includes("tomorrow-oneoff"));
  assert.match(eventsSelects()[0], /market_geo:markets!market_id\(slug\)/);

  mock.timers.reset();
  at(PDT_MIDNIGHT);
  const afterMidnight = await getEventForWebsiteBySlug("today-oneoff");
  assert.ok(afterMidnight);
  assert.equal(afterMidnight.isExpired, true);
});
