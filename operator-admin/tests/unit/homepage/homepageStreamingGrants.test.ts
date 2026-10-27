import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * The streamed homepage's Section resolution (resolvePublicHomepageSections,
 * awaited inside the page's Suspense boundary) against a stubbed PostgREST
 * (globalThis.fetch). Proves the streamed path still applies grant
 * eligibility end to end: a grant recipient's paused recurring event is not
 * shown, the same kind of event for a venue with no grants is, and a failed
 * read drops only its own Section, never showing paused content.
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
/** An open-ended Premium Comp that has started — the recipient is currently Premium. */
const ACTIVE_COMP = { ...EXPIRED_TRIAL, id: "g-2", grant_type: "comp", ends_at: null, reason: "comp" };

const planCtx = (grants: unknown[]) => ({
  plan_ctx_operator_id: OWNER,
  plan_ctx_claimed_at: CLAIMED,
  plan_ctx_subscription: null,
  plan_ctx_grants: grants,
});

function eventRow(id: string, grants: unknown[], recurrence: string) {
  return {
    id, slug: id, venue_id: "v", title: id, description: null, event_type: null, image_url: null, teaser: null,
    first_date: recurrence === "none" ? iso(NOW + 3 * DAY).slice(0, 10) : null, start_time: null, end_time: null,
    recurrence, event_time: null, event_frequency: null, is_seeded_event: false,
    venues: { name: "V", is_published: true, lat: null, lng: null, establishment_type: "Bar", market_geo: { slug: "central-okanagan" }, city_geo: { slug: "kelowna" }, ...planCtx(grants) },
  };
}

type Route = (url: URL) => { status: number; body: unknown } | undefined;
let route: Route = () => undefined;
const realFetch = globalThis.fetch;
const table = (url: URL) => url.pathname.replace("/rest/v1/", "");
/** Event ids a request asked for (`id=in.(a,b)`). */
const requestedIds = (url: URL) => (url.searchParams.get("id") ?? "").replace(/^in\.\(|\)$/g, "").split(",");

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const hit = route(url) ?? { status: 200, body: [] };
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  route = () => undefined;
});

function eventFeature(id: string, eventId: string, displayOrder: number) {
  return {
    id, homepageId: "hp", sectionType: "event" as const, contentMode: "feature" as const, title: id,
    collectionId: null, collection: null, venueId: null, eventId, guideId: null, feature: null,
    displayOrder, isEnabled: true, createdAt: "", updatedAt: "",
  };
}

function homepage(sections: ReturnType<typeof eventFeature>[]) {
  return {
    id: "hp", name: "hp", status: "published" as const, marketId: "m", marketName: "Central Okanagan", cityId: null, cityName: null,
    pageTitle: null, metaTitle: null, metaDescription: null, ogTitle: null, ogDescription: null, canonicalUrl: null,
    createdAt: "", updatedAt: "", sections,
  };
}

const EVENTS: Record<string, unknown> = {
  "recipient-weekly": eventRow("recipient-weekly", [EXPIRED_TRIAL], "weekly"),
  "recipient-oneoff": eventRow("recipient-oneoff", [EXPIRED_TRIAL], "none"),
  "comped-weekly": eventRow("comped-weekly", [ACTIVE_COMP], "weekly"),
  "other-weekly": eventRow("other-weekly", [], "weekly"),
};

test("streamed Sections: a grant recipient's paused recurring event is not shown; eligible content is, in saved order", async () => {
  const { resolvePublicHomepageSections } = await import("@/lib/data/homepagePublic");
  route = (url) =>
    table(url) === "events" ? { status: 200, body: requestedIds(url).map((id) => EVENTS[id]).filter(Boolean) } : undefined;

  const sections = await resolvePublicHomepageSections(
    homepage([
      eventFeature("s-paused", "recipient-weekly", 0),
      eventFeature("s-other", "other-weekly", 1),
      eventFeature("s-oneoff", "recipient-oneoff", 2),
      eventFeature("s-comped", "comped-weekly", 3),
    ]),
    "central-okanagan"
  );
  // Expired-trial recipient on Free: weekly event paused (Section dropped),
  // one-off event still public. Active comp: Premium, so recurring is allowed.
  // No grants: unchanged behaviour.
  assert.deepEqual(sections.map((s) => s.id), ["s-other", "s-oneoff", "s-comped"]);
});

test("streamed Sections: a failed read drops only its own Section, never showing paused content", async () => {
  const { resolvePublicHomepageSections } = await import("@/lib/data/homepagePublic");
  route = (url) => {
    if (table(url) !== "events") return undefined;
    const ids = requestedIds(url);
    if (ids.includes("recipient-weekly")) return { status: 400, body: { code: "PGRST200", message: "relationship missing" } };
    // A row without the grant embed must also fail closed.
    if (ids.includes("recipient-oneoff")) {
      const row = structuredClone(EVENTS["recipient-oneoff"]) as { venues: Record<string, unknown> };
      delete row.venues.plan_ctx_grants;
      return { status: 200, body: [row] };
    }
    return { status: 200, body: ids.map((id) => EVENTS[id]).filter(Boolean) };
  };

  const sections = await resolvePublicHomepageSections(
    homepage([
      eventFeature("s-error", "recipient-weekly", 0),
      eventFeature("s-no-embed", "recipient-oneoff", 1),
      eventFeature("s-other", "other-weekly", 2),
    ]),
    "central-okanagan"
  );
  assert.deepEqual(sections.map((s) => s.id), ["s-other"]);
});

// ── Failure isolation ────────────────────────────────────────────────────────

function venueFeature(id: string, displayOrder: number, venueId: () => string) {
  const s = { ...eventFeature(id, "", displayOrder), sectionType: "venue" as const, eventId: null } as Record<string, unknown>;
  Object.defineProperty(s, "venueId", { get: venueId, enumerable: true });
  return s as unknown as ReturnType<typeof eventFeature>;
}

test("one Section throwing an unexpected exception is reported and left out; the others still resolve", async () => {
  const { resolvePublicHomepageSections } = await import("@/lib/data/homepagePublic");
  route = (url) =>
    table(url) === "events" ? { status: 200, body: requestedIds(url).map((id) => EVENTS[id]).filter(Boolean) } : undefined;
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    const sections = await resolvePublicHomepageSections(
      homepage([
        eventFeature("s-before", "other-weekly", 0),
        venueFeature("s-throws", 1, () => {
          throw new TypeError("unexpected");
        }),
        eventFeature("s-after", "recipient-oneoff", 2),
      ]),
      "central-okanagan"
    );
    assert.deepEqual(sections.map((s) => s.id), ["s-before", "s-after"]);
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((l) => l.includes("[public-homepage] section-resolve failed")), "the failure is reported");
});

test("shared failure: every read failing resolves to no Sections (never a throw), so the page keeps its hero", async () => {
  const { resolvePublicHomepageSections } = await import("@/lib/data/homepagePublic");
  route = () => ({ status: 500, body: { message: "database unavailable" } });
  const sections = await resolvePublicHomepageSections(
    homepage([eventFeature("s-1", "other-weekly", 0), eventFeature("s-2", "recipient-oneoff", 1)]),
    "central-okanagan"
  );
  assert.deepEqual(sections, []);
});

test("shared failure before streaming: a failed Homepage record lookup resolves to null (no homepage), not a throw", async () => {
  const { getPublicHomepageRecordForLocation } = await import("@/lib/data/homepagePublic");
  route = () => ({ status: 500, body: { message: "database unavailable" } });
  assert.equal(await getPublicHomepageRecordForLocation("central-okanagan", "kelowna"), null);
});

test("render-stage failure: the boundary around the Sections renders nothing instead of the global error page", async () => {
  const { HomepageSectionsErrorBoundary } = await import("@/app/(website)/homepage/HomepageSectionsErrorBoundary");
  assert.deepEqual(HomepageSectionsErrorBoundary.getDerivedStateFromError(), { failed: true });
  const boundary = new HomepageSectionsErrorBoundary({ children: "sections" });
  assert.equal(boundary.render(), "sections");
  boundary.state = { failed: true };
  assert.equal(boundary.render(), null);
});
