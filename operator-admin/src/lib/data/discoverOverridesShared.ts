/**
 * Shared constants and types for discover rail overrides.
 * Safe to import from both server components and client components.
 * All server-side data helpers (createAdminClient etc.) live in discoverOverrides.ts.
 */

// ─── Rail key catalog ─────────────────────────────────────────────────────────

export const RAIL_KEYS = [
  "spotlight",
  "patio-picks",
  "highly-rated",
  "featured-nearby",
  "new-this-week",
  "featured-events",
] as const;

export type RailKey = (typeof RAIL_KEYS)[number];

export const RAIL_LABELS: Record<RailKey, string> = {
  "spotlight":       "Spotlight Venues",
  "patio-picks":     "Patio Picks",
  "highly-rated":    "Highly Rated",
  "featured-nearby": "Featured Nearby",
  "new-this-week":   "New This Week",
  "featured-events": "Featured Events",
};

// ─── Reason type catalogs ─────────────────────────────────────────────────────

export const INCLUDE_REASON_TYPES = [
  { value: "strong_local_fit",       label: "Strong local fit" },
  { value: "missing_from_algorithm", label: "Missing from algorithm" },
  { value: "premium_priority",       label: "Premium / internal priority" },
  { value: "seasonal",               label: "Seasonal relevance" },
  { value: "other",                  label: "Other" },
] as const;

export const EXCLUDE_REASON_TYPES = [
  { value: "weak_fit",             label: "Weak fit for this rail" },
  { value: "data_tag_issue",       label: "Data / tag issue" },
  { value: "poor_listing_quality", label: "Poor listing quality" },
  { value: "temporary_removal",    label: "Temporary removal" },
  { value: "other",                label: "Other" },
] as const;

// ─── Event-level override type ────────────────────────────────────────────────
// Minimal shape consumed by the Discover Engine.  The full row type (with
// reason_type, note, created_by, etc.) lives in discoverEventOverrides.ts.

export type EventRailOverride = {
  eventUuid: string;
  action: "include" | "exclude";
};

// ─── Shared row type ─────────────────────────────────────────────────────────

export type RailOverrideRow = {
  id: string;
  railKey: RailKey;
  venueUuid: string;
  action: "include" | "exclude";
  reasonType: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
};
