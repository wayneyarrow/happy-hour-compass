"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { getMembershipRole } from "@/lib/memberships";
import { getVenueSubscription, reserveVenueStripeCustomer } from "@/lib/venueSubscriptions";
import { getStripeClient, getStripePriceId } from "@/lib/stripe";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";
import { getSiteUrl } from "@/lib/siteUrl";

// A legitimate, authenticated, authorized operator directly blocked from
// ever reaching Stripe to pay is treated the same as an acquisition-flow
// customer directly blocked mid-journey — critical, same as
// reportCriticalFailure's other callers. Only reached past every
// expected/customer-correctable check below (not authenticated, not
// resolvable, not owner) — those remain untouched and uninstrumented.
const STRIPE_CHECKOUT_FLOW = "stripe-checkout";

// ─── Checkout ──────────────────────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout Session for upgrading the ACTIVE VENUE to a paid
 * plan.
 *
 * Phase 2B: the billed entity is the operator's server-resolved active venue
 * (ctx.activeVenueId), never a client-supplied id — this function takes no
 * venue parameter at all, by design, so there is nothing for a caller to
 * spoof. One Stripe Customer per venue: if the active venue already has one
 * (venue_subscriptions.billing_provider_customer_id), it is reused; a
 * sibling venue's customer is never read or reused. operator_id is still
 * included in metadata for audit/notification identity only — it does not
 * determine which venue is billed.
 *
 * Returns { ok: true, url } on success — the caller should redirect to url.
 * Returns { ok: false, error } on failure — caller shows user-friendly message.
 *
 * The returned URL is the ONLY thing that should trigger a redirect.
 * Do NOT use the Stripe success redirect URL as the source of truth for plan
 * activation; venue_subscriptions.plan_code is updated exclusively by the
 * webhook handler — an abandoned/cancelled Checkout Session never reaches it.
 */
export async function createCheckoutSessionAction(
  plan: "pro" | "premium"
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator && !ctx.isImpersonating) {
    return { ok: false, error: "Not authenticated." };
  }

  const operatorId = ctx.operator?.id;
  if (!operatorId) return { ok: false, error: "Could not resolve operator." };

  if (!ctx.isImpersonating) {
    const userEmail = ctx.user?.email;
    if (!userEmail) return { ok: false, error: "Could not determine current user." };
    const role = await getMembershipRole(operatorId, userEmail);
    if (role !== "owner") {
      return { ok: false, error: "Only the admin can upgrade the plan." };
    }
  }

  // Server-resolved and server-validated active venue — resolveOperatorContext()
  // already confirmed this venue belongs to the authenticated operator (or is
  // the founder's impersonation target). A 2+-venue operator with no venue
  // selected yet resolves to null here; the subscription page itself already
  // redirects that case to /admin/select-venue before this action is ever
  // reachable, but this function fails safely on its own regardless.
  const activeVenueId = ctx.activeVenueId;
  if (!activeVenueId) {
    return { ok: false, error: "No active venue selected. Please select a venue first." };
  }

  // target plan is already narrowed to "pro" | "premium" by the parameter
  // type — the only two self-serve Stripe-billable plans (see
  // isStripeBillablePlan()) — so no further validation of the plan value
  // itself is needed beyond what getStripePriceId() already enforces below.

  let priceId: string | null;
  try {
    priceId = getStripePriceId(plan);
  } catch (e) {
    console.error("[createCheckoutSessionAction] price ID error:", e instanceof Error ? e.message : e);
    const report = await reportCriticalFailure({
      error: e,
      flow: STRIPE_CHECKOUT_FLOW,
      stage: "checkout-precondition",
      title: "Stripe Checkout Blocked",
      technicalSummary: "price ID misconfigured",
      context: { operatorId, venueId: activeVenueId, plan },
      slackFields: { Plan: plan, "Venue ID": activeVenueId, "Operator ID": operatorId },
    });
    return { ok: false, error: report.customerMessage };
  }

  if (!priceId) {
    return { ok: false, error: "No price configured for that plan." };
  }

  let stripe: ReturnType<typeof getStripeClient>;
  try {
    stripe = getStripeClient();
  } catch (e) {
    console.error("[createCheckoutSessionAction] Stripe client error:", e instanceof Error ? e.message : e);
    const report = await reportCriticalFailure({
      error: e,
      flow: STRIPE_CHECKOUT_FLOW,
      stage: "checkout-precondition",
      title: "Stripe Checkout Blocked",
      technicalSummary: "Stripe client initialization failed",
      context: { operatorId, venueId: activeVenueId, plan },
      slackFields: { Plan: plan, "Venue ID": activeVenueId, "Operator ID": operatorId },
    });
    return { ok: false, error: report.customerMessage };
  }

  const appUrl = getSiteUrl();

  // One Stripe Customer per VENUE — reuse this venue's own customer if it
  // already has one; never read or reuse a sibling venue's customer.
  const subscription = await getVenueSubscription(activeVenueId);
  let customerId = subscription?.billing_provider_customer_id ?? null;

  // ── First-checkout customer reservation (closes the concurrent-checkout
  // race — see reserveVenueStripeCustomer()'s header for the full
  // rationale) ────────────────────────────────────────────────────────────
  //
  // Previously this function passed `customer_email` and let Stripe create
  // a Customer implicitly at checkout completion when none existed yet.
  // customer_email does NOT deduplicate against an existing Customer in
  // Stripe subscription-mode Checkout — it only pre-fills the payment page.
  // Two concurrent first-checkout requests for the same venue (a double-
  // click, two tabs, a retried request) would each independently see no
  // existing customer, each create their OWN new Stripe Customer (and, if
  // both sessions were completed, their own separate active subscription),
  // and the webhook's upsert-by-venue-id would silently overwrite one with
  // the other — leaving the loser's subscription real, billing, and
  // permanently untracked by HHC. Reserving the Customer explicitly and
  // atomically, before ever creating a Checkout Session, closes this
  // entirely: at most one Customer is ever attached to this venue's
  // Checkout going forward, decided by an atomic DB constraint, not by
  // which Stripe webhook happens to arrive last.
  if (!customerId) {
    let newCustomer: Awaited<ReturnType<typeof stripe.customers.create>>;
    try {
      newCustomer = await stripe.customers.create({
        email: ctx.operator?.email,
        metadata: { venue_id: activeVenueId, operator_id: operatorId },
      });
    } catch (e) {
      console.error("[createCheckoutSessionAction] Stripe customer creation failed:", e instanceof Error ? e.message : e);
      const report = await reportCriticalFailure({
        error: e,
        flow: STRIPE_CHECKOUT_FLOW,
        stage: "checkout-customer-create",
        title: "Stripe Checkout Blocked",
        technicalSummary: "Stripe customer creation failed",
        context: { operatorId, venueId: activeVenueId, plan },
        slackFields: { Plan: plan, "Venue ID": activeVenueId, "Operator ID": operatorId },
      });
      return { ok: false, error: report.customerMessage };
    }

    const reservation = await reserveVenueStripeCustomer(activeVenueId, newCustomer.id);

    if (!reservation.ok) {
      // Stripe customer creation succeeded but DB persistence failed for a
      // reason other than "a concurrent request already won" — never
      // proceed to Checkout with a Stripe customer that isn't durably
      // mapped to this venue.
      const report = await reportCriticalFailure({
        error: new Error(reservation.error),
        flow: STRIPE_CHECKOUT_FLOW,
        stage: "checkout-customer-reserve",
        title: "Stripe Checkout Blocked",
        technicalSummary: "venue Stripe customer reservation failed after Stripe customer creation succeeded",
        context: { operatorId, venueId: activeVenueId, plan, stripeCustomerId: newCustomer.id },
        slackFields: { Plan: plan, "Venue ID": activeVenueId, "Stripe Customer": newCustomer.id },
      });
      return { ok: false, error: report.customerMessage };
    }

    if (reservation.reserved) {
      customerId = newCustomer.id;
    } else {
      // Lost the race — a concurrent request reserved this venue's
      // customer first. Use the winner; best-effort clean up the Customer
      // we just created (never referenced by anything, so safe to delete —
      // an unused, un-subscribed Stripe Customer costs and bills nothing
      // even if this cleanup itself fails, so failure here is non-fatal).
      customerId = reservation.row.billing_provider_customer_id;
      stripe.customers.del(newCustomer.id).catch(err =>
        console.error("[createCheckoutSessionAction] cleanup of losing reservation's customer failed (non-fatal):", err)
      );
    }
  }

  if (!customerId) {
    // Defensive — should be unreachable (either the existing row had one,
    // or the reservation above guarantees one). Never fall through to a
    // customer_email-based Checkout, which would reopen the exact race
    // this function exists to close.
    const report = await reportCriticalFailure({
      error: new Error("No Stripe customer id resolved after reservation"),
      flow: STRIPE_CHECKOUT_FLOW,
      stage: "checkout-customer-reserve",
      title: "Stripe Checkout Blocked",
      technicalSummary: "unreachable: customer id missing after reservation succeeded",
      context: { operatorId, venueId: activeVenueId, plan },
      slackFields: { Plan: plan, "Venue ID": activeVenueId },
    });
    return { ok: false, error: report.customerMessage };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/admin/subscription?checkout=success`,
      cancel_url:  `${appUrl}/admin/subscription`,
      metadata: {
        venue_id:    activeVenueId,
        operator_id: operatorId,
        target_plan: plan,
      },
      subscription_data: {
        metadata: {
          venue_id:    activeVenueId,
          operator_id: operatorId,
          target_plan: plan,
        },
      },
    });

    if (!session.url) {
      // Stripe accepted the request and returned a session object but no
      // URL to redirect to — an anomalous, unexpected shape, not a normal
      // Stripe error response (which would have thrown into the catch
      // below instead).
      const report = await reportCriticalFailure({
        error: new Error("Stripe checkout.sessions.create returned no url"),
        flow: STRIPE_CHECKOUT_FLOW,
        stage: "checkout-session-create",
        title: "Stripe Checkout Blocked",
        technicalSummary: "Stripe session created with no redirect url",
        context: { operatorId, venueId: activeVenueId, plan, stripeSessionId: session.id },
        slackFields: { Plan: plan, "Venue ID": activeVenueId, "Stripe Session": session.id },
      });
      return { ok: false, error: report.customerMessage };
    }

    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[createCheckoutSessionAction] Stripe error:", e instanceof Error ? e.message : e);
    const report = await reportCriticalFailure({
      error: e,
      flow: STRIPE_CHECKOUT_FLOW,
      stage: "checkout-session-create",
      title: "Stripe Checkout Blocked",
      technicalSummary: "Stripe checkout session creation failed",
      context: { operatorId, venueId: activeVenueId, plan },
      slackFields: { Plan: plan, "Venue ID": activeVenueId, "Operator ID": operatorId },
    });
    return { ok: false, error: report.customerMessage };
  }
}

// ─── Customer Portal ───────────────────────────────────────────────────────────

/**
 * Creates a Stripe Customer Portal session for the ACTIVE VENUE.
 *
 * Billing management is owner-only — same rule as plan changes
 * (createCheckoutSessionAction above, changePlanAction). Members may view
 * the subscription page but cannot open the billing portal, where they
 * could change payment methods or cancel the subscription directly with
 * Stripe. Impersonation sessions bypass this check, matching every other
 * owner-only action in this file.
 *
 * Because one Stripe Customer = one venue, the portal session created here
 * is naturally scoped to only the active venue's billing — there is no
 * shared customer for a sibling venue's data to leak through.
 *
 * Requires the active venue's venue_subscriptions row to have a
 * billing_provider_customer_id set. Returns { ok: true, url } — caller
 * redirects to url for self-serve billing management.
 */
export async function createPortalSessionAction(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator && !ctx.isImpersonating) {
    return { ok: false, error: "Not authenticated." };
  }

  const operatorId = ctx.operator?.id;
  if (!operatorId) return { ok: false, error: "Could not resolve operator." };

  if (!ctx.isImpersonating) {
    const userEmail = ctx.user?.email;
    if (!userEmail) return { ok: false, error: "Could not determine current user." };
    const role = await getMembershipRole(operatorId, userEmail);
    if (role !== "owner") {
      return { ok: false, error: "Only the admin can manage billing." };
    }
  }

  const activeVenueId = ctx.activeVenueId;
  if (!activeVenueId) {
    return { ok: false, error: "No active venue selected. Please select a venue first." };
  }

  const subscription = await getVenueSubscription(activeVenueId);
  const customerId = subscription?.billing_provider_customer_id ?? null;

  if (!customerId) {
    return { ok: false, error: "No billing account found. Please contact support." };
  }

  let stripe: ReturnType<typeof getStripeClient>;
  try {
    stripe = getStripeClient();
  } catch (e) {
    console.error("[createPortalSessionAction] Stripe client error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Billing is temporarily unavailable. Please try again later." };
  }

  const appUrl = getSiteUrl();

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${appUrl}/admin/subscription`,
    });

    return { ok: true, url: portalSession.url };
  } catch (e) {
    console.error("[createPortalSessionAction] Stripe error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Billing is temporarily unavailable. Please try again later." };
  }
}
