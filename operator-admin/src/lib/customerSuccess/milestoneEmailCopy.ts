/**
 * Approved venue-view-milestone email copy (Customer Success Phase 1B
 * preview). Pure data — no rendering, no I/O.
 *
 * Wording is approved copy and must not be substantially rewritten here —
 * only the `{venue}` placeholder is filled in at render time
 * (milestoneEmailTemplate.ts). Every milestone in VENUE_VIEW_MILESTONES
 * (venueViewMilestones.ts) has an entry here, and this module is the single
 * source of truth for which milestones have approved copy — the template
 * and preview route both read through it rather than hardcoding the list
 * again.
 */

import { VENUE_VIEW_MILESTONES } from "./venueViewMilestones";

export type MilestoneCopy = {
  milestone: number;
  /** Comma-formatted display value, e.g. "1,000". */
  displayValue: string;
  /** Contains the literal token `{venue}` — substitute before sending/rendering. */
  subject: string;
  previewText: string;
  /** Contains the celebratory emoji already baked in — do not append another. */
  headline: string;
  label: "VENUE VIEWS";
  /** Two paragraphs. Paragraph 1 contains the literal token `{venue}`. */
  body: [string, string];
};

/** Identical across every milestone — kept in one place rather than repeated per entry. */
export const MILESTONE_EMAIL_CLOSING =
  "Thanks for being part of Happy Hour Compass. We’re happy to keep sending people your way.";

const COPY_BY_MILESTONE: Record<number, MilestoneCopy> = {
  50: {
    milestone: 50,
    displayValue: "50",
    subject: "\u{1F389} {venue} just hit 50 views on Happy Hour Compass",
    previewText: "Your venue is getting noticed.",
    headline: "You’re getting noticed. \u{1F389}",
    label: "VENUE VIEWS",
    body: [
      "{venue} has now reached 50 venue views on Happy Hour Compass.",
      "It’s an early milestone, but a good one — people are finding your venue and checking out what you have to offer.",
    ],
  },
  100: {
    milestone: 100,
    displayValue: "100",
    subject: "\u{1F389} {venue} just reached 100 views",
    previewText: "You’re building some traction.",
    headline: "You’re building traction. \u{1F389}",
    label: "VENUE VIEWS",
    body: [
      "{venue} has now reached 100 venue views on Happy Hour Compass.",
      "That’s a great milestone — your venue is getting discovered, and people are taking a closer look at what you have to offer.",
    ],
  },
  250: {
    milestone: 250,
    displayValue: "250",
    subject: "\u{1F389} 250 views for {venue}",
    previewText: "Your venue is picking up momentum.",
    headline: "You’re picking up momentum. \u{1F389}",
    label: "VENUE VIEWS",
    body: [
      "{venue} has now reached 250 venue views on Happy Hour Compass.",
      "That’s a meaningful milestone. More and more people are discovering your venue and seeing what makes it worth a visit.",
    ],
  },
  500: {
    milestone: 500,
    displayValue: "500",
    subject: "\u{1F389} {venue} just reached 500 views",
    previewText: "Your venue is building real momentum.",
    headline: "You’re building real momentum. \u{1F389}",
    label: "VENUE VIEWS",
    body: [
      "{venue} has now reached 500 venue views on Happy Hour Compass.",
      "That’s a great milestone — more and more people are discovering your venue and checking out what you have to offer.",
    ],
  },
  1000: {
    milestone: 1000,
    displayValue: "1,000",
    subject: "\u{1F389} 1,000 views for {venue}",
    previewText: "That’s a milestone worth celebrating.",
    headline: "That’s a milestone worth celebrating. \u{1F389}",
    label: "VENUE VIEWS",
    body: [
      "{venue} has now reached 1,000 venue views on Happy Hour Compass.",
      "That’s a big milestone, and a great sign that people are continuing to discover your venue through HHC.",
    ],
  },
  2500: {
    milestone: 2500,
    displayValue: "2,500",
    subject: "\u{1F389} {venue} just passed 2,500 views",
    previewText: "Your venue keeps getting discovered.",
    headline: "People keep finding you. \u{1F389}",
    label: "VENUE VIEWS",
    body: [
      "{venue} has now reached 2,500 venue views on Happy Hour Compass.",
      "That’s a fantastic milestone and a strong sign that your venue continues to attract attention from people looking for great places to go.",
    ],
  },
  5000: {
    milestone: 5000,
    displayValue: "5,000",
    subject: "\u{1F389} 5,000 views — what a milestone for {venue}",
    previewText: "This one is worth celebrating.",
    headline: "Now that’s some serious momentum. \u{1F389}",
    label: "VENUE VIEWS",
    body: [
      "{venue} has now reached 5,000 venue views on Happy Hour Compass.",
      "That’s an incredible milestone. Your venue continues to get discovered by people looking for somewhere great to eat, drink and go out.",
    ],
  },
};

// Fail loudly at module load if VENUE_VIEW_MILESTONES and the copy map
// ever drift apart, rather than silently rendering a missing milestone.
for (const m of VENUE_VIEW_MILESTONES) {
  if (!COPY_BY_MILESTONE[m]) {
    throw new Error(`milestoneEmailCopy.ts is missing approved copy for the ${m}-view milestone`);
  }
}

/** All milestones with approved copy, ascending — mirrors VENUE_VIEW_MILESTONES. */
export const MILESTONE_EMAIL_VALUES: readonly number[] = VENUE_VIEW_MILESTONES;

/** Returns the approved copy for a milestone, or null if it isn't one of the 7 approved values. */
export function getMilestoneEmailCopy(milestone: number): MilestoneCopy | null {
  return COPY_BY_MILESTONE[milestone] ?? null;
}
