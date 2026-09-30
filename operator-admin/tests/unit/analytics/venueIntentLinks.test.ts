import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TrackedVenueLink,
  trackVenueIntentClick,
} from "../../../src/app/(website)/venueIntentTracking";

/**
 * Public website Website/Menu links → /api/track/venue-click, plus the
 * wiring of every website surface and the expand-tracking semantics shared
 * with the consumer app. fetch is stubbed; nothing leaves the process.
 */

// The unit-test runner compiles JSX with the classic runtime.
(globalThis as { React?: typeof React }).React = React;

const VENUE_UUID = "3f2b8c1e-5d4a-4e6f-9a1b-2c3d4e5f6a7b";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as Record<string, unknown>).sessionStorage;
});

function body(call: Call) {
  return JSON.parse(String(call.init.body)) as { venueId: string; clickType: string; sessionId: string };
}

test("trackVenueIntentClick posts one keepalive event with the venue UUID", () => {
  trackVenueIntentClick(VENUE_UUID, "menu");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/track/venue-click");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.keepalive, true);
  const b = body(calls[0]);
  assert.equal(b.venueId, VENUE_UUID);
  assert.equal(b.clickType, "menu");
  assert.ok(b.sessionId.length > 0);
});

test("a rejected tracking request or a throwing fetch never surfaces to the caller", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  assert.doesNotThrow(() => trackVenueIntentClick(VENUE_UUID, "website"));
  globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  assert.doesNotThrow(() => trackVenueIntentClick(VENUE_UUID, "website"));
  globalThis.fetch = (() => { throw new TypeError("sync"); }) as unknown as typeof fetch;
  assert.doesNotThrow(() => trackVenueIntentClick(VENUE_UUID, "website"));
  await new Promise((r) => setImmediate(r));
});

test("TrackedVenueLink preserves anchor attributes and emits exactly one event per activation", () => {
  const props = {
    venueId: VENUE_UUID,
    clickType: "website" as const,
    href: "https://kettleriver.example",
    target: "_blank",
    rel: "noopener noreferrer",
    className: "text-blue-600",
    children: "kettleriver.example",
  };
  const html = renderToStaticMarkup(React.createElement(TrackedVenueLink, props));
  assert.equal(
    html,
    '<a href="https://kettleriver.example" target="_blank" rel="noopener noreferrer" class="text-blue-600">kettleriver.example</a>'
  );

  const el = TrackedVenueLink(props) as React.ReactElement<React.AnchorHTMLAttributes<HTMLAnchorElement>>;
  let defaultPrevented = false;
  let callerOnClick = 0;
  const withCallerHandler = TrackedVenueLink({ ...props, onClick: () => { callerOnClick++; } }) as typeof el;
  const evt = { preventDefault: () => { defaultPrevented = true; } } as unknown as React.MouseEvent<HTMLAnchorElement>;

  el.props.onClick!(evt);
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...body(calls[0]), sessionId: "-" }, { venueId: VENUE_UUID, clickType: "website", sessionId: "-" });

  withCallerHandler.props.onClick!(evt);
  assert.equal(calls.length, 2);
  assert.equal(callerOnClick, 1);
  assert.equal(defaultPrevented, false, "navigation must never be prevented");
});

test("TrackedVenueLink without a clickType (Directions/Call) records nothing", () => {
  const el = TrackedVenueLink({ venueId: VENUE_UUID, href: "https://maps.example" }) as React.ReactElement<
    React.AnchorHTMLAttributes<HTMLAnchorElement>
  >;
  el.props.onClick!({} as React.MouseEvent<HTMLAnchorElement>);
  assert.equal(calls.length, 0);
});

// ── Surface wiring ─────────────────────────────────────────────────────────

const SRC = join(__dirname, "../../../src/app");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const VENUE_PAGE = read("(website)/[market]/[city]/[slug]/page.tsx");
const VENUE_CARD = read("(website)/[market]/[city]/[slug]/VenueActionCard.tsx");
const VENUE_BAR = read("(website)/[market]/[city]/[slug]/MobileActionBar.tsx");
const EVENT_CONTENT = read("(website)/website-events/[id]/EventDetailContent.tsx");
const EVENT_CARD = read("(website)/website-events/[id]/EventActionCard.tsx");
const EVENT_BAR = read("(website)/website-events/[id]/EventMobileActionBar.tsx");

test("website venue page: Website/Menu info rows tracked with the venue UUID, attributes unchanged", () => {
  assert.match(VENUE_PAGE, /<TrackedVenueLink\s+venueId=\{venue\.venueUuid\}\s+clickType="website"\s+href=\{websiteUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(VENUE_PAGE, /<TrackedVenueLink\s+venueId=\{venue\.venueUuid\}\s+clickType="menu"\s+href=\{menuUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/);
  // Expand trackers now receive the UUID, not the slug (venue.id).
  assert.match(VENUE_PAGE, /<HappyHourTimesCard\s+venueId=\{venue\.venueUuid\}/);
  assert.match(VENUE_PAGE, /<BusinessHoursRow hoursWeekly=\{venue\.hoursWeekly\} venueId=\{venue\.venueUuid\} \/>/);
  assert.doesNotMatch(VENUE_PAGE, /venueId=\{venue\.id\}/);
  // Both action components receive the UUID.
  assert.equal((VENUE_PAGE.match(/venueId=\{venue\.venueUuid\}/g) ?? []).length, 8);
});

test("website VenueActionCard and MobileActionBar track Menu and Website only", () => {
  assert.match(VENUE_CARD, /label="View Menu"\s+onClick=\{\(\) => trackVenueIntentClick\(venueId, "menu"\)\}/);
  assert.match(VENUE_CARD, /label="Visit Website"\s+onClick=\{\(\) => trackVenueIntentClick\(venueId, "website"\)\}/);
  assert.equal((VENUE_CARD.match(/trackVenueIntentClick\(/g) ?? []).length, 2);

  assert.match(VENUE_BAR, /label: "Menu",\s+intent: "menu" as const/);
  assert.match(VENUE_BAR, /label: "Website",\s+intent: "website" as const/);
  assert.equal((VENUE_BAR.match(/intent: "/g) ?? []).length, 2);
  assert.match(VENUE_BAR, /onClick=\{action\.intent \? \(\) => trackVenueIntentClick\(venueId, action\.intent!\) : undefined\}/);
  assert.match(VENUE_BAR, /target=\{action\.href\.startsWith\("http"\) \? "_blank" : undefined\}/);
});

test("website event page: venue Website/Menu links tracked with the event's venue UUID", () => {
  assert.match(EVENT_CONTENT, /<TrackedVenueLink venueId=\{event\.venueId\} clickType="website" href=\{websiteUrl\} target="_blank" rel="noopener noreferrer"/);
  assert.match(EVENT_CONTENT, /<TrackedVenueLink venueId=\{event\.venueId\} clickType="menu" href=\{menuUrl\} target="_blank" rel="noopener noreferrer"/);
  assert.equal((EVENT_CONTENT.match(/venueId=\{event\.venueId\}/g) ?? []).length, 4);
  assert.match(EVENT_CARD, /label="Visit Website"\s+icon=\{<GlobeIcon \/>\}\s+subtle\s+intent="website"/);
  assert.equal((EVENT_CARD.match(/intent="/g) ?? []).length, 1);
  assert.match(EVENT_BAR, /label: "Website",\s+intent: "website" as const/);
  assert.equal((EVENT_BAR.match(/intent: "/g) ?? []).length, 1);
});

// ── Expand semantics (consumer components, unmodified) ─────────────────────

test("HH schedule / business hours: only the collapsed→open transition records an event", () => {
  const hh = read("(consumer)/venue/[id]/HappyHourTimesCard.tsx");
  const hours = read("(consumer)/event/[id]/BusinessHoursRow.tsx");
  assert.match(hh, /const opening = !expanded;\s+setExpanded\(\(v\) => !v\);\s+if \(opening\) \{\s+fetch\("\/api\/track\/venue-click"[\s\S]{0,400}clickType: "hh_schedule_expand"/);
  assert.match(hours, /const opening = !expanded;\s+setExpanded\(\(v\) => !v\);\s+if \(opening && venueId\) \{\s+fetch\("\/api\/track\/venue-click"[\s\S]{0,400}clickType: "business_hours_expand"/);
});
