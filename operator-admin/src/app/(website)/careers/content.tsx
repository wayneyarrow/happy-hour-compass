/**
 * Static copy + data for the public Careers page. Kept separate from
 * page.tsx the same way /business and /claim-your-venue split content.tsx
 * from layout — page.tsx stays focused on structure, this file stays
 * focused on the words (and, for Current Openings, the one piece of data
 * that will eventually come from somewhere other than a hard-coded array).
 */

// ── Current openings ─────────────────────────────────────────────────────────
//
// No CMS or jobs table in V1 (out of scope) — this typed array is the whole
// "data model" for now. It's genuinely empty today, which CurrentOpenings.tsx
// renders as an honest empty state rather than any placeholder job cards.
// Adding a real opening later is just pushing a JobOpening into this array;
// CurrentOpenings.tsx already has the non-empty rendering path ready.

export type JobOpening = {
  id: string;
  title: string;
  department: string;
  location: string;
};

export const OPEN_POSITIONS: readonly JobOpening[] = [];

// ── Where we'll grow ─────────────────────────────────────────────────────────

export type FutureTeam = {
  id: string;
  name: string;
  description: string;
};

export const FUTURE_TEAMS: readonly FutureTeam[] = [
  {
    id: "engineering",
    name: "Engineering",
    description: "Building and scaling the product.",
  },
  {
    id: "design",
    name: "Design",
    description: "Shaping how people experience Happy Hour Compass.",
  },
  {
    id: "content-marketing",
    name: "Content & Marketing",
    description: "Helping people discover what we're building.",
  },
  {
    id: "sales-partnerships",
    name: "Sales & Partnerships",
    description: "Bringing more venues onto the platform.",
  },
  {
    id: "customer-success",
    name: "Customer Success",
    description: "Supporting the businesses and people who use Happy Hour Compass.",
  },
] as const;
