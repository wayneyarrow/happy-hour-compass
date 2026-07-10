/**
 * Shared constants, types, and pure validators for the Collections data
 * layer (migration 058_collections_homepages_foundation.sql). Safe to
 * import from both Server Components and client components — no DB access
 * here. Server-side reads/writes live in collections.ts, mirroring the
 * existing discoverOverridesShared.ts / discoverOverrides.ts and
 * contentGuideDistributionShared.ts / contentGuideDistribution.ts splits.
 *
 * See docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md for the product
 * model this implements.
 */

// ── Collection type / status ─────────────────────────────────────────────────

export const COLLECTION_TYPES = ["venue", "event", "guide"] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];

export function isCollectionType(value: string): value is CollectionType {
  return (COLLECTION_TYPES as readonly string[]).includes(value);
}

export type CollectionStatus = "draft" | "published";

/** Coerces a raw DB status value into the two-state model — mirrors normalizeGuideStatus() in contentGuides.ts. */
export function normalizeCollectionStatus(status: string): CollectionStatus {
  return status === "published" ? "published" : "draft";
}

// ── Algorithm key registry ───────────────────────────────────────────────────
//
// algorithm_key is intentionally an application-dispatched named key (see
// migration 058's COMMENT ON COLUMN collections.algorithm_key) — the same
// pattern already used by discover_rail_overrides.rail_key
// (discoverOverridesShared.ts RAIL_KEYS) and
// content_guide_channels.channel_key (contentGuideDistributionShared.ts).
//
// V1's supported keys are derived directly from the six live Discover Engine
// rails (RAIL_KEYS) — no new algorithms are introduced here, only named so a
// future Collections resolver can eventually dispatch to the same underlying
// logic discoverEngine.ts already implements. Five rails select venues;
// "featured-events" selects events. There is no live algorithmic rail for
// guides yet (see migration 058's collection_guide_items header comment), so
// the guide algorithm set is intentionally empty in V1 — a Guide Collection's
// algorithmKey must be null until a real algorithmic guide feed exists.

export const ALGORITHM_KEYS = [
  "spotlight",
  "patio-picks",
  "highly-rated",
  "featured-nearby",
  "new-this-week",
  "featured-events",
] as const;

export type AlgorithmKey = (typeof ALGORITHM_KEYS)[number];

/** Which Collection type each supported algorithm key is compatible with. */
export const ALGORITHM_COLLECTION_TYPE: Record<AlgorithmKey, CollectionType> = {
  "spotlight":       "venue",
  "patio-picks":     "venue",
  "highly-rated":    "venue",
  "featured-nearby": "venue",
  "new-this-week":   "venue",
  "featured-events": "event",
};

export function isAlgorithmKey(value: string): value is AlgorithmKey {
  return (ALGORITHM_KEYS as readonly string[]).includes(value);
}

/**
 * Central compatibility gate — the only place that decides whether an
 * algorithm_key value is acceptable for a given Collection type. Returns
 * null when valid (including algorithmKey === null, which is always valid —
 * a manual-only Collection), or a short, user-facing error otherwise. Every
 * write path (createCollection, updateCollection) must run candidate values
 * through this rather than re-deriving the rule.
 */
export function validateAlgorithmKey(
  algorithmKey: string | null,
  collectionType: CollectionType
): string | null {
  if (algorithmKey === null) return null;
  if (!isAlgorithmKey(algorithmKey)) {
    return `Unsupported algorithm key "${algorithmKey}".`;
  }
  if (ALGORITHM_COLLECTION_TYPE[algorithmKey] !== collectionType) {
    return `Algorithm "${algorithmKey}" is not compatible with ${collectionType} Collections.`;
  }
  return null;
}

/** Item limit must be a positive whole number, or null (no cap) — mirrors the collections_item_limit_positive CHECK. */
export function validateItemLimit(itemLimit: number | null): string | null {
  if (itemLimit === null) return null;
  if (!Number.isInteger(itemLimit) || itemLimit <= 0) {
    return "Item limit must be a positive whole number.";
  }
  return null;
}

// ── Result types ──────────────────────────────────────────────────────────────
// Mirrors the ActionResult convention already used by app/control-panel
// actions.ts files (e.g. discover/actions.ts) so a future server-action
// layer can wrap these with zero shape translation.

export type CollectionWriteResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type CollectionMutationResult =
  | { success: true }
  | { success: false; error: string };

// ── Row types ────────────────────────────────────────────────────────────────

/** List-row shape — enough to render a management list without N+1 queries (market/city names joined in). */
export type CollectionSummary = {
  id: string;
  name: string;
  description: string | null;
  collectionType: CollectionType;
  status: CollectionStatus;
  algorithmKey: AlgorithmKey | null;
  marketId: string;
  marketName: string;
  cityId: string | null;
  cityName: string | null;
  updatedAt: string;
};

export type CollectionVenueOverride = {
  id: string;
  collectionId: string;
  venueId: string;
  venueName: string | null;
  action: "include" | "exclude";
  boost: number;
  sortOrder: number;
  reasonType: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type CollectionEventOverride = {
  id: string;
  collectionId: string;
  eventId: string;
  eventTitle: string | null;
  action: "include" | "exclude";
  boost: number;
  sortOrder: number;
  reasonType: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type CollectionGuideItem = {
  id: string;
  collectionId: string;
  guideId: string;
  guideTitle: string | null;
  sortOrder: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

/** One Homepage Section that references this Collection — the unit getCollectionUsage() reports. */
export type CollectionUsageEntry = {
  homepageId: string;
  homepageName: string;
  homepageStatus: "draft" | "published";
  homepageMarketName: string;
  homepageCityName: string | null;
  sectionId: string;
  sectionType: CollectionType;
  sectionTitle: string;
};

/**
 * Answers the three questions the future delete-protection UI needs (see
 * docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md "Collection Usage &
 * Deletion Protection"): which Homepages use this Collection, via which
 * Section (type + public title), and whether any of them is published.
 * This is read-only reporting — it does NOT weaken or replace the DB's own
 * ON DELETE RESTRICT backstop on homepage_sections_collection_type_match
 * (migration 058); a delete attempt against an in-use Collection still fails
 * at the database level regardless of what this summary reports.
 */
export type CollectionUsageSummary = {
  collectionId: string;
  isUsedByPublishedHomepage: boolean;
  entries: CollectionUsageEntry[];
};

export type CollectionDetail = {
  id: string;
  name: string;
  description: string | null;
  collectionType: CollectionType;
  marketId: string;
  marketName: string;
  cityId: string | null;
  cityName: string | null;
  status: CollectionStatus;
  algorithmKey: AlgorithmKey | null;
  itemLimit: number | null;
  createdAt: string;
  updatedAt: string;
  /** Populated when collectionType === "venue", otherwise []. */
  venueOverrides: CollectionVenueOverride[];
  /** Populated when collectionType === "event", otherwise []. */
  eventOverrides: CollectionEventOverride[];
  /** Populated when collectionType === "guide", otherwise []. */
  guideItems: CollectionGuideItem[];
  usage: CollectionUsageSummary;
};

// ── List filters ─────────────────────────────────────────────────────────────

export type CollectionListFilters = {
  status?: CollectionStatus;
  collectionType?: CollectionType;
  marketId?: string;
  cityId?: string;
  /** Case-insensitive substring match against name. */
  search?: string;
};
