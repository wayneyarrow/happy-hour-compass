import { test } from "node:test";
import assert from "node:assert/strict";
import { computeActiveVenueId } from "../../../src/lib/impersonation";

/**
 * Pins the exact multi-venue active-venue decision (Phase 1, 2026-08-29) —
 * see the "Multi-venue ownership" note on provisionOperatorForVenue
 * (src/lib/operatorActivation.ts) and computeActiveVenueId's own doc comment
 * in src/lib/impersonation.ts. This is the one piece of the venue-resolution
 * pipeline with no Supabase/cookie I/O, so it's the one directly unit-tested
 * — resolveVenuesAndActiveVenue() itself is not (real Supabase admin client
 * calls, no DI seam — same reasoning as every other flow-specific contract
 * test in this repo, see operatorActivationObservability.test.ts).
 */

const VENUE_A = { id: "venue-a", name: "Venue A", slug: "venue-a", city: null, region: null, is_published: true };
const VENUE_B = { id: "venue-b", name: "Venue B", slug: "venue-b", city: null, region: null, is_published: true };
const FOREIGN_VENUE_ID = "venue-belongs-to-someone-else";

function base(overrides: Partial<Parameters<typeof computeActiveVenueId>[0]> = {}) {
  return {
    isImpersonating: false,
    hasOperator: true,
    sessionVenueId: null,
    impersonatingVenueId: null,
    venues: [] as typeof VENUE_A[],
    cookieVenueId: null,
    ...overrides,
  };
}

test("zero venues: no active venue (existing empty-state path, unchanged)", () => {
  assert.equal(computeActiveVenueId(base({ venues: [] })), null);
});

test("one venue: auto-selected — no selection screen needed", () => {
  assert.equal(computeActiveVenueId(base({ venues: [VENUE_A] })), "venue-a");
});

test("two venues, no cookie: no active venue — caller must show the selection screen", () => {
  assert.equal(computeActiveVenueId(base({ venues: [VENUE_A, VENUE_B] })), null);
});

test("two venues, cookie matches an owned venue: that venue becomes active", () => {
  assert.equal(
    computeActiveVenueId(base({ venues: [VENUE_A, VENUE_B], cookieVenueId: "venue-b" })),
    "venue-b"
  );
});

test("two venues, cookie does not match any owned venue: rejected, treated as no selection", () => {
  // Covers both a forged/tampered cookie and a stale one pointing at a venue
  // the operator no longer owns (or never owned) — e.g. another operator's
  // venue id. This is the authorization boundary: a cookie value alone is
  // never sufficient, it must appear in this operator's own venue list.
  assert.equal(
    computeActiveVenueId(base({ venues: [VENUE_A, VENUE_B], cookieVenueId: FOREIGN_VENUE_ID })),
    null
  );
});

test("no operator, not impersonating: no active venue", () => {
  assert.equal(computeActiveVenueId(base({ hasOperator: false, venues: [VENUE_A] })), null);
});

test("impersonation Case A (operator set): active venue is always the session's venue, ignoring the operator's own venue count/cookie", () => {
  assert.equal(
    computeActiveVenueId(
      base({
        isImpersonating: true,
        hasOperator: true,
        sessionVenueId: "venue-b",
        venues: [VENUE_A, VENUE_B],
        cookieVenueId: "venue-a", // must be ignored during impersonation
      })
    ),
    "venue-b"
  );
});

test("impersonation Case B (orphan venue, no operator): active venue is the impersonated venue id directly", () => {
  assert.equal(
    computeActiveVenueId(
      base({
        isImpersonating: true,
        hasOperator: false,
        impersonatingVenueId: "orphan-venue",
        venues: [],
      })
    ),
    "orphan-venue"
  );
});
