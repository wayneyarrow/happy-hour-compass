/**
 * Pure venue-identity resolution for Stripe webhook events (Phase 2B
 * billing architecture review, Part 5). Extracted out of
 * src/app/api/webhooks/stripe/route.ts into its own module for two
 * reasons:
 *   1. Next.js's App Router forbids any named export from a route.ts file
 *      other than the HTTP method handlers and a small config allow-list
 *      (dynamic, revalidate, etc.) — a build-time constraint, not a style
 *      preference.
 *   2. It has no I/O of its own, so it can be unit-tested directly without
 *      a database — the same rationale as computeActiveVenueId()
 *      (src/lib/impersonation.ts) and resolvePlanCodeFromVenueSubscription()/
 *      highestPlan() (src/lib/venueSubscriptions.ts). See
 *      tests/unit/subscriptions/webhookVenueIdentityMismatch.test.ts for the
 *      executable coverage of every scenario in Part 5 of the review.
 */

/** One independently-known venue identity, and which source it came from. */
export type VenueIdentityCandidate = {
  source: "metadata" | "customer" | "subscription";
  venueId: string;
};

export type ResolveVenueResult =
  | { venueId: string | null; mismatch: false }
  | { venueId: null; mismatch: true; candidates: VenueIdentityCandidate[] };

/**
 * Given the three ALREADY-RESOLVED identity sources for a Stripe webhook
 * event — metadata.venue_id, a venue_subscriptions lookup by customer id,
 * and a venue_subscriptions lookup by subscription id — decides the venue
 * or detects a mismatch.
 *
 * "Priority order" governs which single source to trust when only ONE
 * identity is known (metadata is preferred when nothing else is available
 * yet, e.g. a brand-new subscription with no venue_subscriptions row at
 * all). It never means "ignore a contradictory lower-priority mapping" —
 * whenever more than one source resolves to a value, ALL of them are
 * compared; if they disagree about which venue owns this event, that is a
 * mismatch regardless of which source would have "won" a priority
 * ordering. This closes a real gap an earlier, short-circuiting
 * implementation had: a customer id mapped to Venue A and a subscription
 * id mapped to Venue B, with no metadata to arbitrate, would previously
 * resolve silently to A (customer id was checked first) without ever
 * noticing B disagreed.
 *
 * Any disagreement fails closed: the caller must not use any of the
 * candidate values, and must fail loudly (reportCriticalFailure) and drop
 * the event without writing anything. This can never be silently guessed
 * away — it would mean metadata was tampered/corrupted, or a Stripe
 * customer/subscription id got attached to the wrong venue's row.
 */
export function resolveVenueIdentity(params: {
  metadataVenueId: string | null;
  customerMappedVenueId: string | null;
  subscriptionMappedVenueId: string | null;
}): ResolveVenueResult {
  const candidates: VenueIdentityCandidate[] = [];
  if (params.metadataVenueId)           candidates.push({ source: "metadata", venueId: params.metadataVenueId });
  if (params.customerMappedVenueId)     candidates.push({ source: "customer", venueId: params.customerMappedVenueId });
  if (params.subscriptionMappedVenueId) candidates.push({ source: "subscription", venueId: params.subscriptionMappedVenueId });

  const distinctVenueIds = new Set(candidates.map((c) => c.venueId));

  if (distinctVenueIds.size > 1) {
    return { venueId: null, mismatch: true, candidates };
  }

  return { venueId: candidates[0]?.venueId ?? null, mismatch: false };
}
