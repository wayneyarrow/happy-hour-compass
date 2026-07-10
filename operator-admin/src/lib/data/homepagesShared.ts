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

export type HomepageSection = {
  id: string;
  homepageId: string;
  sectionType: HomepageSectionType;
  title: string;
  collectionId: string | null;
  /** null when collectionId is null, OR when collectionId points to a Collection that no longer resolves (should not happen given ON DELETE RESTRICT, but reads defensively). */
  collection: HomepageSectionCollectionRef | null;
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

// ── Homepage <-> Collection geography compatibility (V1 rule) ───────────────
//
// Approved V1 rule (see implementation summary for the full rationale — the
// product spec is explicit that a City Homepage falls back to its parent
// Market Homepage publicly, but is ambiguous about whether a City Homepage's
// EDITOR may directly assign a parent Market Collection to one of its own
// Sections. This implements the least-restrictive-safe reading requested for
// that ambiguity, while cross-market assignment is unambiguous and always
// rejected):
//
//   Market Homepage (cityId null) -> only Market Collections of the same market.
//   City Homepage (cityId set)    -> same-city Collections, OR the parent
//                                     Market Collection (editorial reuse,
//                                     consistent with the City -> Market
//                                     public fallback already approved for
//                                     whole-Homepage resolution).
//   Cross-market (any direction)  -> always rejected.
//
// Pure — callers fetch both records themselves; this performs no DB access,
// so it is reusable from Section create/update validation, a future bulk
// section-replace, and a future admin "assignable collections" list without
// each call site re-deriving the rule.

export function isCollectionAssignableToHomepage(
  homepage: { marketId: string; cityId: string | null },
  collection: { marketId: string; cityId: string | null }
): boolean {
  if (collection.marketId !== homepage.marketId) return false;
  if (homepage.cityId === null) {
    return collection.cityId === null;
  }
  return collection.cityId === homepage.cityId || collection.cityId === null;
}
