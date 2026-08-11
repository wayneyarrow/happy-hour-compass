/**
 * Lightweight GA4 custom-event helper — wraps @next/third-parties/google's
 * sendGAEvent(), the same package that already renders <GoogleAnalytics> in
 * (website)/layout.tsx. No new dependency.
 *
 * Rules (mirrors src/lib/analytics.ts's Vercel Analytics helper):
 *  - Client-safe: guard against SSR context via typeof window check.
 *  - Never throws: all errors are swallowed so tracking can never break the app.
 *  - No personal data: callers must not pass email, name, phone, or free-text fields.
 *  - Safely no-ops when GA4 hasn't loaded — sendGAEvent() itself already
 *    guards this (it checks whether <GoogleAnalytics> has ever mounted), which
 *    is exactly what makes Production-only environment scoping of
 *    NEXT_PUBLIC_GA_MEASUREMENT_ID (see (website)/layout.tsx) sufficient on
 *    its own: on an environment where the measurement ID is unset,
 *    <GoogleAnalytics> never renders, so every call here is a safe no-op.
 *
 * Scoped to the approved GA4 V1 custom-event set (Claim Venue funnel, Add
 * Venue funnel, discovery filtering — see the GA4 V1 measurement plan).
 * Widening this union is a deliberate measurement-plan decision, not a
 * casual addition.
 */

import { sendGAEvent } from "@next/third-parties/google";

type GA4EventName =
  | "claim_started"
  | "claim_submitted"
  | "venue_submission_started"
  | "venue_submission_completed"
  | "discovery_filtered";

type GA4EventParams = Record<string, string | number | boolean | null | undefined>;

export function trackGA4Event(name: GA4EventName, params?: GA4EventParams): void {
  if (typeof window === "undefined") return;
  try {
    // sendGAEvent()'s type declaration (Object[]) rejects `undefined`
    // arguments, so params is only passed through when actually provided.
    if (params) {
      sendGAEvent("event", name, params);
    } else {
      sendGAEvent("event", name);
    }
  } catch {
    // Intentionally swallowed — tracking must never affect app behaviour.
  }
}
