/**
 * Weekly Picks newsletter signup — shared, client-safe definitions.
 *
 * Signup is Brevo-managed double opt-in with no HHC database state (see
 * signup.ts). This module holds what both the form and the server action
 * must agree on: the consent wording, the fixed placement identifiers, and
 * email validation.
 *
 * The newsletter's public name is "Your Happy Hour Plans" (it was "Weekly
 * Picks" — internal identifiers, the /weekly-picks route and analytics
 * events keep the old name). Confirmed signups join the existing HHC
 * Consumers list in Brevo (see getWeeklyPicksBrevoConfig()).
 * There is no permission checkbox: pressing the signup button, with
 * WEEKLY_PICKS_CONSENT_TEXT directly beside it, is the consent action, and
 * Brevo's own double opt-in confirmation is still required before anyone
 * is added to the list.
 */

export const WEEKLY_PICKS_CONSENT_TEXT =
  "By signing up, you agree to receive Your Happy Hour Plans, the Happy Hour Compass newsletter, by email. Unsubscribe anytime.";

export const WEEKLY_PICKS_SIGNUP_BUTTON_LABEL = "Sign me up";

/**
 * Fixed signup placements. The value is the only thing sent to analytics
 * (never to Brevo) — never free text.
 */
export const WEEKLY_PICKS_PLACEMENTS = [
  "weekly_picks_page",
  "homepage_main",
  "homepage_bottom",
  "guide_end",
] as const;

export type WeeklyPicksPlacement = (typeof WEEKLY_PICKS_PLACEMENTS)[number];

export function isWeeklyPicksPlacement(value: unknown): value is WeeklyPicksPlacement {
  return typeof value === "string" && (WEEKLY_PICKS_PLACEMENTS as readonly string[]).includes(value);
}

/**
 * Splits the homepage's displayed sections around the main signup.
 * `sections` must already be the sections actually displayed (enabled and
 * resolved to content — homepagePublic.ts filters these), so the first
 * entry is the first visible section. Order and identities are untouched.
 *   0 sections → no main signup, bottom invitation only.
 *   1 section  → main signup after it, no bottom invitation (never two
 *                signups back to back).
 *   2+         → main after the first, bottom after the rest.
 */
export function splitSectionsAroundSignup<T>(sections: readonly T[]): {
  first: T[];
  rest: T[];
  showMainSignup: boolean;
  showBottomSignup: boolean;
} {
  return {
    first: sections.slice(0, 1),
    rest: sections.slice(1),
    showMainSignup: sections.length > 0,
    showBottomSignup: sections.length !== 1,
  };
}

/** RFC 5321 maximum address length. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately simple: one "@", a non-empty local part, and a dotted domain
 * with no whitespace. Brevo and the confirmation email are the real check.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lowercased address — the form Brevo and the staging guard compare. */
export function normalizeWeeklyPicksEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidWeeklyPicksEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

/**
 * Result of a signup request. "accepted" means only that Brevo returned 2xx
 * for the double opt-in request — not a confirmed or new subscriber.
 */
export type WeeklyPicksSignupState =
  | { status: "idle" }
  | { status: "accepted" }
  | {
      status: "error";
      message?: string;
      fieldErrors?: { email?: string };
      turnstileFailed?: boolean;
    };

// ── User-facing copy ─────────────────────────────────────────────────────────

/** Small label above the headline; rendered uppercase by CSS. */
export const WEEKLY_PICKS_EYEBROW = "Free weekly newsletter";
export const WEEKLY_PICKS_HEADLINE = "Your Happy Hour Plans";
export const WEEKLY_PICKS_PROMISE =
  "Get local happy hours, food finds, daily specials and events across Kelowna, West Kelowna and Lake Country in your inbox every Thursday. Free.";

export const WEEKLY_PICKS_EMAIL_REQUIRED_MESSAGE = "Enter your email address.";
export const WEEKLY_PICKS_EMAIL_INVALID_MESSAGE = "Enter a valid email address, like you@example.com.";
export const WEEKLY_PICKS_GENERIC_ERROR_MESSAGE =
  "We couldn't sign you up right now. Please try again in a few minutes.";
export const WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE =
  "Newsletter signup is limited to approved test addresses on this staging site.";
