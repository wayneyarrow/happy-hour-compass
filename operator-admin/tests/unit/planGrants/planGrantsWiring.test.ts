import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Comp / Trial Part 1 — static wiring guards. Pins the separation the
 * approved design depends on:
 *   - Stripe handlers/actions and billing writes never touch grants;
 *   - paid reporting (founder dashboard) stays billing-only;
 *   - every Operator Admin feature gate checks the EFFECTIVE plan;
 *   - the subscription page / modal / cancellation path use the BILLING plan;
 *   - every public reader of plan-gated content goes through the per-request
 *     public plan state (content policy + ranking);
 *   - founder grant actions are admin-gated and write only via the RPCs.
 */

const ROOT = join(__dirname, "../../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Source with block and line comments removed — for "never calls X" checks. */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const BILLING_FILES = [
  "src/app/api/webhooks/stripe/route.ts",
  "src/app/admin/subscription/stripeActions.ts",
  "src/app/admin/subscription/changePlanAction.ts",
  "src/app/admin/venue/cancelActions.ts",
  "src/lib/venueSubscriptions.ts",
  "src/lib/stripe.ts",
  "src/lib/stripeVenueIdentity.ts",
  "src/lib/planChangeEvents.ts",
  "src/lib/subscriptions.ts",
];

test("Stripe handlers, billing actions and billing helpers never import grant code", () => {
  for (const file of BILLING_FILES) {
    assert.doesNotMatch(src(file), /planGrants|venue_plan_grant/, `${file} must stay grant-free`);
  }
});

test("grant code never writes billing tables or logs plan_change_events", () => {
  const files = [
    "src/lib/planGrants/server.ts",
    "src/lib/planGrants/grantState.ts",
    "src/lib/planGrants/contentPolicy.ts",
    "src/lib/planGrants/publicPlanState.ts",
    "src/app/control-panel/venues/[id]/planGrantActions.ts",
    "src/lib/data/planGrantsReport.ts",
  ];
  for (const file of files) {
    const s = code(file);
    assert.doesNotMatch(s, /from\("venue_subscriptions"\)\s*\.(insert|update|upsert|delete)/, file);
    assert.doesNotMatch(s, /sync_venue_plan_entitlement|updateVenuePlan|syncVenueStripeSubscription|logPlanChangeEvent|plan_change_events/, file);
    assert.doesNotMatch(s, /from\("venue_plan_grants"\)\s*\.(insert|update|upsert|delete)/, `${file}: grant writes go through RPCs only`);
  }
});

test("paid-venue counts and revenue reporting stay billing-only (grants excluded by construction)", () => {
  assert.doesNotMatch(src("src/lib/data/founderDashboard.ts"), /planGrants|venue_plan_grant/);
});

test("Operator Admin feature gates check the effective plan", () => {
  const gates: Array<[string, number]> = [
    ["src/app/admin/events/actions.ts", 1],
    ["src/app/admin/venue/imageActions.ts", 1],
    ["src/app/admin/happy-hours/actions.ts", 2],
    ["src/app/admin/daily-specials/actions.ts", 1],
    ["src/app/admin/venue/searchTagsActions.ts", 1],
  ];
  for (const [file, n] of gates) {
    const s = src(file);
    assert.equal((s.match(/await getVenueEffectivePlan\(/g) ?? []).length, n, file);
    assert.doesNotMatch(s, /getVenuePlanCode\(/, `${file} must not gate on the billing-only plan`);
  }
  for (const file of ["src/app/admin/users/page.tsx", "src/app/admin/users/actions.ts", "src/app/admin/subscription/page.tsx"]) {
    assert.match(src(file), /getOperatorHighestEffectivePlan\(/, `${file}: team seats follow effective plans`);
  }
  assert.match(src("src/lib/activeVenuePlan.ts"), /plan: access\.effectivePlan, billingPlan/);
});

test("subscription page: Change Plan modal and cancellation save-path use the BILLING plan", () => {
  const s = src("src/app/admin/subscription/page.tsx");
  assert.match(s, /const billingPlan: OperatorPlan = ctx\.activeVenueBillingPlan;/);
  assert.equal((s.match(/currentPlan=\{billingPlan\}/g) ?? []).length, 2);
  assert.doesNotMatch(s, /currentPlan=\{plan\}/);
});

test("every public reader embeds the venue plan context in the SAME query as the content", () => {
  const venues = src("src/lib/data/venues.ts");
  assert.equal((venues.match(/\$\{VENUE_PLAN_CONTEXT_EMBED\}/g) ?? []).length, 3, "list, detail, by-UUIDs selects");
  assert.equal((venues.match(/rowToConsumerVenue\(row, \{/g) ?? []).length, 3, "every venue mapping resolves the embedded context");
  assert.doesNotMatch(venues, /\.map\(rowToConsumerVenue\)/);
  assert.doesNotMatch(venues, /getPublicPlanState/);

  const events = src("src/lib/data/events.ts");
  for (const fn of [
    "getEventForConsumerById",
    "getEventsForConsumerVenues",
    "getPublishedEventsForConsumer",
    "getCPFeaturedEventCandidates",
    "getPublishedEventsForWebsite",
    "getEventForWebsiteByField",
    "getEventPreviewsByIds",
    "getPublishedEventsByIds",
  ]) {
    const start = events.indexOf(`function ${fn}(`);
    assert.ok(start >= 0, fn);
    const next = events.indexOf("\nexport ", start + 10);
    const body = events.slice(start, next === -1 ? undefined : next);
    assert.match(body, /VENUE_PLAN_(ONLY|CONTEXT)_EMBED/, `${fn} must embed the venue plan context`);
    assert.match(body, /isRowPubliclyActive\(/, `${fn} must filter paused events`);
    assert.match(body, /is_seeded_event/, `${fn} must select is_seeded_event for the grandfathered exception`);
    assert.match(body, /catch \(err\)/, `${fn} must turn a missing embed into its normal error result`);
  }

  const specials = src("src/lib/data/dailySpecials.ts");
  for (const fn of ["getDailySpecialsForVenue", "getDailySpecialById", "getPublishedDailySpecialsForWebsite"]) {
    const start = specials.indexOf(`function ${fn}(`);
    const next = specials.indexOf("\nexport ", start + 10);
    const body = specials.slice(start, next === -1 ? undefined : next);
    assert.match(body, /VENUE_PLAN_(ONLY|CONTEXT)_EMBED/, fn);
    assert.match(body, /isSpecialPubliclyActive\(/, fn);
  }

  // No separate, independently-failing public grant lookup exists any more.
  assert.doesNotMatch(src("src/lib/planGrants/server.ts"), /getPublicPlanState/);
});

test("paused events are excluded before sorting/counting/occurrence expansion (filter precedes upcomingBucket)", () => {
  const events = src("src/lib/data/events.ts");
  const start = events.indexOf("function getPublishedEventsForConsumer(");
  const body = events.slice(start, events.indexOf("\nexport ", start + 10));
  assert.ok(body.indexOf("isRowPubliclyActive(") < body.indexOf("rows.sort("));
  const web = events.slice(events.indexOf("function getPublishedEventsForWebsite("));
  assert.ok(web.indexOf("isRowPubliclyActive(") < web.indexOf("haversineKm("));
});

test("founder grant actions are admin-gated and write only through the migration-109 RPCs", () => {
  const s = src("src/app/control-panel/venues/[id]/planGrantActions.ts");
  assert.match(s, /^"use server";/);
  assert.match(s, /isControlPanelAdmin\(user\.email\)/);
  for (const fn of ["createPlanGrantAction", "changePlanGrantEndAction", "revokePlanGrantAction"]) {
    const start = s.indexOf(`export async function ${fn}(`);
    const body = s.slice(start, s.indexOf("\nexport ", start + 10));
    assert.ok(body.indexOf("await getAdmin()") > 0, `${fn} checks admin first`);
    assert.ok(body.indexOf("await getAdmin()") < body.indexOf(".rpc("), `${fn} checks admin before writing`);
  }
  assert.match(s, /rpc\("create_venue_plan_grant"/);
  assert.match(s, /rpc\("change_venue_plan_grant_end"/);
  assert.match(s, /rpc\("revoke_venue_plan_grant"/);
  // change/revoke pass the bound venue so the RPC rejects a mismatched grant.
  assert.equal((s.match(/p_venue_id:\s+venueId,/g) ?? []).length, 3);
});

test("Venue Funnel places venues by effective plan and keeps billing/grant badges separate", () => {
  const s = src("src/lib/data/venueFunnel.ts");
  assert.match(s, /const plan = access\.effectivePlan;/);
  assert.match(s, /describePlanBadges\(/);
});

test("Control Panel venue page no longer shows the legacy operators.plan as the venue's plan", () => {
  const s = src("src/app/control-panel/venues/[id]/page.tsx");
  assert.doesNotMatch(s, /operators!created_by_operator_id\(plan/);
  assert.match(s, /<PlanGrantPanel/);
  assert.match(s, /getPlanGrantNotesForVenue\(/);
});

test("operator editors mark individual paused items (not just a total) using the same public policy", () => {
  const hh = src("src/app/admin/happy-hours/page.tsx");
  assert.match(hh, /pausedFromIndex=\{publicPolicy\.enforced \? foodLimit : null\}/);
  assert.match(hh, /pausedFromIndex=\{publicPolicy\.enforced \? drinkLimit : null\}/);
  assert.match(src("src/app/admin/happy-hours/SpecialsForm.tsx"), /i >= pausedFromIndex[\s\S]*Paused — not shown to guests/);

  const venue = src("src/app/admin/venue/page.tsx");
  assert.match(venue, /pausedFromIndex=\{publicPolicy\.enforced \? imageLimit : null\}/);
  assert.match(venue, /pausedTags=\{publicPolicy\.enforced \? currentSearchTags\.slice\(tagLimit\) : \[\]\}/);
  assert.match(src("src/app/admin/venue/VenueImagesSection.tsx"), /i >= pausedFromIndex[\s\S]*Paused — not shown to guests/);

  for (const page of ["src/app/admin/events/page.tsx", "src/app/admin/daily-specials/page.tsx"]) {
    assert.match(src(page), /publicPolicy=\{policyFromAccess\(ctx\.activeVenueAccess\)\}/, page);
  }
  assert.match(src("src/app/admin/events/EventsManager.tsx"), /isEventPaused\(event\)[\s\S]*Paused/);
  assert.match(src("src/app/admin/daily-specials/DailySpecialsManager.tsx"), /isSpecialPaused\(special\)[\s\S]*Paused/);
});

test("every grant embed names the FK (venue_plan_grant_events makes the relationship ambiguous otherwise — PGRST201)", () => {
  for (const file of ["src/lib/planGrants/publicPlanState.ts", "src/lib/planGrants/server.ts", "src/lib/data/planGrantsReport.ts", "src/lib/data/venueNotes.ts"]) {
    const s = code(file);
    for (const m of s.matchAll(/venue_plan_grants(!|\()/g)) {
      assert.equal(m[1], "!", `${file}: venue_plan_grants embed without an FK hint`);
    }
    assert.doesNotMatch(s, /venues!inner\(/, `${file}: venues embed from venue_plan_grants needs the FK hint`);
  }
  assert.match(code("src/lib/planGrants/publicPlanState.ts"), /venue_plan_grants!venue_plan_grants_venue_id_fkey\(/);
  assert.match(code("src/lib/planGrants/server.ts"), /venues!venue_plan_grants_venue_id_fkey!inner\(/);
});
