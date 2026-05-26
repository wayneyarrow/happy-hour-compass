/**
 * Centralized recommendation rule library for Homepage V2 — Suggested Next Steps.
 *
 * Pure module — no DB queries, no side effects.
 * Rules are priority-ordered; computeSuggestedSteps() returns the first
 * MAX_CARDS that apply given the current operator/venue state.
 *
 * To add a new card: append a Rule to RULES. Priority is determined by position.
 */

import type { VenueReadinessSignals } from "./venueReadiness";

// ── Public types ──────────────────────────────────────────────────────────────

export type SuggestionCard = {
  id: string;
  /** Emoji used as the card icon. */
  icon: string;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
};

export type SuggestionsInput = {
  signals: VenueReadinessSignals;
  /** Count of operator-uploaded images (those stored in the venue-images bucket). */
  operatorImageCount: number;
  /** Total event rows for this venue (any status). */
  eventsCount: number;
  /** Count of valid food special items (from parseSpecialItemCount). */
  foodSpecialsCount: number;
  /** Count of valid drink special items (from parseSpecialItemCount). */
  drinkSpecialsCount: number;
};

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Nudge operators to keep adding photos until they reach this count. */
const PHOTO_TARGET = 5;

/**
 * Combined food + drink count below this value is considered "sparse."
 * V2 requires at least 1 food + 1 drink (min = 2). A threshold of 4 means
 * operators with exactly the minimum (1+1 or 1+2) still see the nudge.
 */
const SPECIALS_SPARSE_THRESHOLD = 4;

// ── Rule definitions ──────────────────────────────────────────────────────────
// Rules are evaluated in order. First MAX_CARDS that apply are returned.

const MAX_CARDS = 3;

type Rule = {
  id: string;
  applies: (input: SuggestionsInput) => boolean;
  card: SuggestionCard;
};

const RULES: Rule[] = [
  // ── Priority 1: Profile completeness ─────────────────────────────────────
  {
    id: "add_website",
    applies: ({ signals }) => !signals.hasWebsite,
    card: {
      id: "add_website",
      icon: "🌐",
      title: "Add your website",
      description: "Help customers learn more about your venue before they visit.",
      ctaLabel: "Add website",
      href: "/admin/venue?section=links#links",
    },
  },
  {
    id: "add_menu",
    applies: ({ signals }) => !signals.hasMenuLink,
    card: {
      id: "add_menu",
      icon: "📋",
      title: "Add your menu",
      description: "Let customers browse your offerings before choosing where to go.",
      ctaLabel: "Add menu",
      href: "/admin/venue?section=links#links",
    },
  },
  {
    id: "add_payment_methods",
    applies: ({ signals }) => !signals.hasPaymentTypes,
    card: {
      id: "add_payment_methods",
      icon: "💳",
      title: "Add payment methods",
      description: "Customers want to know what you accept before they arrive.",
      ctaLabel: "Add payment methods",
      href: "/admin/venue?section=payment-types#payment-types",
    },
  },

  // ── Priority 2: Photos ────────────────────────────────────────────────────
  {
    id: "upload_more_photos",
    applies: ({ operatorImageCount }) => operatorImageCount < PHOTO_TARGET,
    card: {
      id: "upload_more_photos",
      icon: "📸",
      title: "Upload more photos",
      description: "Listings with more photos feel more complete and trustworthy.",
      ctaLabel: "Manage photos",
      href: "/admin/images",
    },
  },

  // ── Priority 3: Events ────────────────────────────────────────────────────
  {
    id: "add_first_event",
    applies: ({ eventsCount }) => eventsCount === 0,
    card: {
      id: "add_first_event",
      icon: "🎉",
      title: "Add your first event",
      description: "Promote live events to bring in new customers on quieter nights.",
      ctaLabel: "Add event",
      href: "/admin/events",
    },
  },

  // ── Priority 4: Specials depth ────────────────────────────────────────────
  {
    id: "add_more_specials",
    applies: ({ foodSpecialsCount, drinkSpecialsCount }) =>
      foodSpecialsCount + drinkSpecialsCount < SPECIALS_SPARSE_THRESHOLD,
    card: {
      id: "add_more_specials",
      icon: "🍺",
      title: "Add more specials",
      description: "Richer specials listings attract more curious customers.",
      ctaLabel: "Update specials",
      href: "/admin/happy-hours",
    },
  },
];

// ── Public: compute function ──────────────────────────────────────────────────

/**
 * Returns up to MAX_CARDS suggestion cards that apply to the current venue state.
 * Cards are ordered by priority (rule insertion order in RULES).
 * Returns an empty array when no rules apply — callers should render the empty state.
 */
export function computeSuggestedSteps(input: SuggestionsInput): SuggestionCard[] {
  return RULES.filter((rule) => rule.applies(input))
    .slice(0, MAX_CARDS)
    .map((rule) => rule.card);
}
