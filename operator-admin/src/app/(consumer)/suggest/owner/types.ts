/**
 * Shared types for the operator submission flow (Phase 3A).
 * Used by both the client component and the server actions.
 */

/**
 * Structured Google Places match result — canonical definition now lives in
 * src/lib/google/placesMatch.ts (shared with automatic reconciliation and
 * the Founder Control Panel manual fallback). Re-exported here so existing
 * imports from "./types" (client components, etc.) keep working unchanged.
 *
 * rating and reviewCount are fetched and stored in google_match_json for later
 * use but are intentionally NOT displayed on the confirmation screen (by design).
 */
import type { GoogleMatch } from "@/lib/google/placesMatch";
export type { GoogleMatch } from "@/lib/google/placesMatch";

/** Form values collected from the initial operator submission form. */
export type OwnerFormValues = {
  businessName: string;
  streetAddress: string;
  city: string;
  province: string;
  firstName: string;
  lastName: string;
  position: string;
  email: string;
};

/** Result returned by lookupBusinessAction. */
export type LookupResult = {
  /** Best Google match, or null if none found or API unavailable. */
  match: GoogleMatch | null;
  /** General error message (non-field). */
  error?: string;
  /** Per-field validation errors. */
  fieldErrors?: Record<string, string>;
};

/** Payload passed to saveOperatorSubmissionAction. */
export type SavePayload = {
  formValues: OwnerFormValues;
  match: GoogleMatch | null;
  matchConfirmed: boolean;
  rejectionNotes?: string;
  website?: string;
  additionalNotes?: string;
  /** Cloudflare Turnstile token — verified server-side before any side effect. */
  turnstileToken: string | null;
};

/** Result returned by saveOperatorSubmissionAction. */
export type SaveResult = {
  success?: boolean;
  error?: string;
  /** Set when `error` is specifically a failed Turnstile verification, so
   *  the caller knows to reset the widget rather than just show the error. */
  turnstileFailed?: boolean;
  /**
   * Phase 3B routing outcome (see saveOperatorSubmissionAction's routing
   * doc comment) — "confirmed_auto" is the only outcome that's actually
   * instant/no-review; "pending_review" and "double_claim" both mean an
   * existing venue was matched and the submission was routed for manual
   * review instead. Callers should not assume a successful save means
   * instant approval without checking this.
   */
  routedStatus?: string;
};
