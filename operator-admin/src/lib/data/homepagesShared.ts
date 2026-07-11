/**
 * Shared constants, types, and pure validators for the Homepages data layer
 * (migration 058_collections_homepages_foundation.sql). Safe to import from
 * both Server Components and client components — no DB access here.
 * Server-side reads/writes live in homepages.ts, mirroring the
 * collectionsShared.ts / collections.ts split.
 *
 * See docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md for the product
 * model this implements.
 */

import type { CollectionType, CollectionStatus } from "./collectionsShared";

// ── Homepage status ──────────────────────────────────────────────────────────

export type HomepageStatus = "draft" | "published";

/** Coerces a raw DB status value into the two-state model — mirrors normalizeCollectionStatus(). */
export function normalizeHomepageStatus(status: string): HomepageStatus {
  return status === "published" ? "published" : "draft";
}

// ── Homepage Section type ────────────────────────────────────────────────────
//
// Intentionally the exact same three values as CollectionType (see migration
// 058's COMMENT ON TABLE homepage_sections): the DB enforces Section Type /
// Collection Type compatibility via a composite FK that only works because
// the two columns share one code space. Aliasing the type here keeps that
// guarantee visible in TypeScript too, rather than letting the two unions
// drift independently.

export type HomepageSectionType = CollectionType;
export const HOMEPAGE_SECTION_TYPES = ["venue", "event", "guide"] as const;

export function isHomepageSectionType(value: string): value is HomepageSectionType {
  return (HOMEPAGE_SECTION_TYPES as readonly string[]).includes(value);
}

// ── Content mode + Section Kind (Homepage Sections editor V1) ───────────────
//
// migration 060 adds `content_mode` alongside the existing `section_type`:
// a Section is fully described by the pair (section_type, content_mode).
// collection = assembles a reusable Collection (existing behavior).
// feature = hand-picks exactly one Venue/Event/Guide directly, no Collection
// involved. `HomepageSectionKind` is the six-value union the editor UI
// actually presents ("Venue Collection", "Venue Feature", etc.) — a pure
// client-facing convenience over the (section_type, content_mode) pair
// stored in the DB; the pair stays the source of truth everywhere else
// (queries, composite FK compatibility) so section_type keeps sharing one
// code space with collections.collection_type exactly as migration 058
// established.

export type HomepageSectionContentMode = "collection" | "feature";

/** Coerces a raw DB content_mode value — mirrors normalizeHomepageStatus(). */
export function normalizeContentMode(value: string): HomepageSectionContentMode {
  return value === "feature" ? "feature" : "collection";
}

export type HomepageSectionKind =
  | "venue_collection"
  | "event_collection"
  | "guide_collection"
  | "venue_feature"
  | "event_feature"
  | "guide_feature";

export const HOMEPAGE_SECTION_KINDS: HomepageSectionKind[] = [
  "venue_collection",
  "event_collection",
  "guide_collection",
  "venue_feature",
  "event_feature",
  "guide_feature",
];

export const SECTION_KIND_LABELS: Record<HomepageSectionKind, string> = {
  venue_collection: "Venue Collection",
  event_collection: "Event Collection",
  guide_collection: "Guide Collection",
  venue_feature: "Venue Feature",
  event_feature: "Event Feature",
  guide_feature: "Guide Feature",
};

export function isHomepageSectionKind(value: string): value is HomepageSectionKind {
  return (HOMEPAGE_SECTION_KINDS as readonly string[]).includes(value);
}

export function toSectionKind(
  sectionType: HomepageSectionType,
  contentMode: HomepageSectionContentMode
): HomepageSectionKind {
  return `${sectionType}_${contentMode}` as HomepageSectionKind;
}

export function fromSectionKind(
  kind: HomepageSectionKind
): { sectionType: HomepageSectionType; contentMode: HomepageSectionContentMode } {
  const [sectionType, contentMode] = kind.split("_") as [HomepageSectionType, HomepageSectionContentMode];
  return { sectionType, contentMode };
}

// ── Result types ──────────────────────────────────────────────────────────────

export type HomepageWriteResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type HomepageMutationResult =
  | { success: true }
  | { success: false; error: string };

// ── Row types ────────────────────────────────────────────────────────────────

export type HomepageSummary = {
  id: string;
  name: string;
  status: HomepageStatus;
  marketId: string;
  marketName: string;
  cityId: string | null;
  cityName: string | null;
  updatedAt: string;
};

/** Minimal Collection metadata joined onto a section — enough for a future editor without a second round trip. */
export type HomepageSectionCollectionRef = {
  id: string;
  name: string;
  collectionType: CollectionType;
  status: CollectionStatus;
  marketId: string;
  cityId: string | null;
};

/** Minimal Venue/Event/Guide metadata joined onto a Feature section — the single-item equivalent of HomepageSectionCollectionRef. */
export type HomepageSectionFeatureRef = {
  id: string;
  /** Venue/Event title or Guide title. */
  name: string;
  secondaryLabel: string | null;
};

/** A Published Guide eligible for a Guide Feature Section's content picker — GuideFeaturePicker.tsx's small, fully-loaded (not server-searched) candidate list. Unlike collections.ts's GuideCandidate, there's no `status` field — Feature candidates are always pre-filtered to Published only, so the field would never vary. */
export type HomepageGuideFeatureCandidate = {
  id: string;
  title: string;
  marketName: string;
  cityName: string | null;
};

export type HomepageSection = {
  id: string;
  homepageId: string;
  sectionType: HomepageSectionType;
  contentMode: HomepageSectionContentMode;
  title: string;
  collectionId: string | null;
  /** null when collectionId is null, OR when collectionId points to a Collection that no longer resolves (should not happen given ON DELETE RESTRICT, but reads defensively). Only meaningful when contentMode = "collection". */
  collection: HomepageSectionCollectionRef | null;
  venueId: string | null;
  eventId: string | null;
  guideId: string | null;
  /** Resolved display ref for whichever of venueId/eventId/guideId is set — only meaningful when contentMode = "feature". */
  feature: HomepageSectionFeatureRef | null;
  displayOrder: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HomepageDetail = {
  id: string;
  name: string;
  status: HomepageStatus;
  marketId: string;
  marketName: string;
  cityId: string | null;
  cityName: string | null;
  pageTitle: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  canonicalUrl: string | null;
  createdAt: string;
  updatedAt: string;
  /** Ordered by displayOrder ascending. */
  sections: HomepageSection[];
};

// ── List filters ─────────────────────────────────────────────────────────────

export type HomepageListFilters = {
  status?: HomepageStatus;
  marketId?: string;
  cityId?: string;
};

// ── Homepage <-> Collection geography compatibility (approved rule) ─────────
//
// Corrected after browser QA found Kelowna (city) Collections missing from
// the Central Okanagan (market) Homepage's picker — the Market Homepage
// branch previously required collection.cityId === null, which wrongly
// rejected every city-level Collection within the market instead of
// accepting them. The approved rule:
//
//   Market Homepage (cityId null) -> Collections assigned directly to that
//                                     market (cityId null), OR any city-level
//                                     Collection belonging to a city within
//                                     that same market.
//   City Homepage (cityId set)    -> same-city Collections, OR the parent
//                                     Market Collection (editorial reuse,
//                                     consistent with the City -> Market
//                                     public fallback already approved for
//                                     whole-Homepage resolution). Never a
//                                     different city's Collections, even
//                                     within the same market.
//   Cross-market (any direction)  -> always rejected.
//
// Pure — callers fetch both records themselves; this performs no DB access,
// so it is reusable from Section create/update validation, a future bulk
// section-replace, and the admin "assignable collections" list (both UI
// availability and server-side validation share this single function —
// see getAssignableCollectionsForSection / validateSectionCollectionAssignment
// in homepages.ts) without each call site re-deriving the rule.

export function isCollectionAssignableToHomepage(
  homepage: { marketId: string; cityId: string | null },
  collection: { marketId: string; cityId: string | null }
): boolean {
  if (collection.marketId !== homepage.marketId) return false;
  if (homepage.cityId === null) return true;
  return collection.cityId === homepage.cityId || collection.cityId === null;
}
