"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import {
  createCollection,
  updateCollection,
  getCollectionById,
  replaceVenueOverrides,
  replaceEventOverrides,
  replaceGuideItems,
  archiveCollection,
  restoreCollection,
  isCollectionType,
  isAlgorithmKey,
  type CollectionType,
  type CollectionStatus,
  type VenueOverrideInput,
  type EventOverrideInput,
  type GuideItemInput,
} from "@/lib/data/collections";
import { resolveCollectionPreview, type CollectionPreviewResult } from "@/lib/data/collectionsPreview";
import type { CollectionVenueOverride, CollectionEventOverride, CollectionGuideItem, AlgorithmKey } from "@/lib/data/collectionsShared";
import { searchVenueCandidates, searchEventCandidates, type AttachmentCandidate } from "@/lib/data/contentGuideAttachments";

/**
 * Server actions for Collections Management V1
 * (docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md). Mirrors the
 * create/update action pattern already used by content-engine/actions.ts —
 * every action independently re-checks CP admin access.
 *
 * Sequencing (per task guardrail — no DB transaction available): the
 * Collection's own core fields are written first; membership is only
 * replaced after that write succeeds. If the core write fails, nothing else
 * runs and the error surfaces immediately. If membership replacement fails
 * after a successful core write, the response says so explicitly rather than
 * reporting a bare success — the admin can retry the membership save without
 * re-entering the core fields, and the previous membership rows are left
 * untouched by replaceVenueOverrides/replaceEventOverrides/replaceGuideItems'
 * own delete-then-insert-only-on-successful-validation design (they validate
 * every row before deleting anything).
 *
 * createCollectionAction always writes status = "draft", regardless of what
 * (if anything) the client submitted — the create page never renders a
 * Status control (see CollectionForm's module docstring), so this is a
 * server-side guarantee, not just a hidden UI default. Publishing is a
 * decision the full editor makes later, once content actually exists.
 *
 * Publish-failure guarantee: updateCollectionAction validates BEFORE writing
 * anything when the submitted status is "published" (see the Publishing
 * validation block below). A failed publish attempt therefore never writes
 * to the database at all — it cannot "revert" a Collection to Draft, because
 * nothing is saved until validation passes. On failure, the submitted field
 * values are echoed back via CollectionFormState.values so the form can
 * re-display exactly what the admin attempted (including their chosen
 * Published status) rather than silently falling back to whatever was last
 * persisted.
 *
 * generateCollectionResultAction is intentionally read-only. There is no
 * standalone "Generate"/"Regenerate" button anymore (removed — Algorithmic
 * Collections are generated once, automatically, at creation; see
 * CollectionForm.tsx's module docstring for the full product rule); this
 * action now exists purely to power ResolvedCollectionTable.tsx's live
 * editorial refinement — re-resolving the merged algorithm + override view
 * immediately after an exclude/restore/boost/add/reorder edit, without
 * requiring the Collection to be saved first (Market/City/Algorithm/Item
 * Limit are locked by that point, so only the override rows themselves can
 * actually change between calls).
 *
 * Item limit is required for Algorithmic Collections on create (see the
 * field-error check in createCollectionAction) — Manual/Guide Collections
 * never submit an algorithm_key, so the check never applies to them.
 *
 * Curation Method (Manual vs Algorithmic), Algorithm, and Item Limit are
 * fixed at creation and never editable afterward — "Algorithmic Collections
 * are generated once during creation" (approved V1 product rule). See
 * CollectionForm.tsx's module docstring for the full rationale.
 * updateCollectionAction enforces this unconditionally: it never reads
 * algorithm_key or item_limit from formData at all, always using the
 * Collection's own already-stored algorithmKey/itemLimit instead, and never
 * passes them to updateCollection() (so the DB columns are never touched by
 * an update, regardless of what a stale tab or crafted request might submit
 * — the CollectionForm Edit UI simply doesn't render controls for these
 * anymore, but that's a UX convenience, not the enforcement mechanism).
 *
 * Automatic generation for an Algorithmic Collection does NOT happen in
 * createCollectionAction or updateCollectionAction — the redirect target
 * below is unchanged (`.../edit?success=created#collection-content`), and
 * the Edit page's own initial load (control-panel/collections/[id]/edit/page.tsx)
 * calls resolveCollectionPreviewById() (src/lib/data/collectionsPreview.ts)
 * on EVERY visit to an Algorithmic Collection's Edit page — not just right
 * after creation — to resolve and display its current base pool + stored
 * overrides. This is load/display behavior, not a user-triggered action:
 * there is no "Generate"/"Regenerate" button anywhere in the normal Edit
 * flow (see ResolvedCollectionTable.tsx's module docstring). It funnels
 * through the exact same resolveCollectionPreview() the override-editing
 * handlers below (via generateCollectionResultAction) already use — nothing
 * about the algorithm is duplicated, and a resolution failure can never
 * affect whether the Draft Collection exists or what's stored.
 */

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getCallerEmail(): Promise<string | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user?.email) return null;
    if (!(await isControlPanelAdmin(user.email))) return null;
    return user.email;
  } catch {
    return null;
  }
}

// ── Form state ────────────────────────────────────────────────────────────────

export type CollectionFieldKey =
  | "name" | "collection_type" | "market_id" | "city_id" | "algorithm_key" | "item_limit" | "status";

/** Echoed back on a failed submit so the form can re-display exactly what was attempted — see module docstring. */
export type CollectionFormValues = {
  name: string;
  description: string | null;
  marketId: string;
  cityId: string | null;
  algorithmKey: string | null;
  itemLimit: number | null;
  status: CollectionStatus;
};

export type CollectionFormState = {
  error?: string;
  fieldErrors?: Partial<Record<CollectionFieldKey, string>>;
  values?: CollectionFormValues;
};

const COLLECTION_STATUSES: CollectionStatus[] = ["draft", "published"];

// ── Parsing helpers ───────────────────────────────────────────────────────────

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function nullableStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length > 0 ? v : null;
}

function parseItemLimit(formData: FormData): { value: number | null; error: string | null } {
  const raw = str(formData, "item_limit");
  if (!raw) return { value: null, error: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { value: null, error: "Item limit must be a positive whole number." };
  }
  return { value: n, error: null };
}

export type OverrideRowInput = {
  id: string;
  action: "include" | "exclude";
  boost: number;
  /** MANUAL_ADD_REASON marks a genuine editor add, vs null for a reorder/boost promotion row — see MembershipRow's doc comment in ResolvedCollectionTable.tsx. */
  reasonType: string | null;
};

function parseOverrideRows(formData: FormData, key: string): OverrideRowInput[] {
  const raw = str(formData, key);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      id: typeof r.id === "string" ? r.id : "",
      action: r.action === "exclude" ? "exclude" as const : "include" as const,
      boost: typeof r.boost === "number" && Number.isFinite(r.boost) ? Math.max(0, Math.min(100, r.boost)) : 0,
      reasonType: typeof r.reasonType === "string" && r.reasonType.length > 0 ? r.reasonType : null,
    }))
    .filter((r) => r.id !== "");
}

function parseGuideRows(formData: FormData): string[] {
  const raw = str(formData, "guide_items");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
}

// ── Preview-input builders ───────────────────────────────────────────────────
//
// resolveCollectionPreview() expects the full CollectionVenueOverride /
// CollectionEventOverride / CollectionGuideItem row shapes (it's also used
// to read already-saved rows in the editor's old server-computed path). Both
// the Publish validation check and generateCollectionResultAction below only
// have the client's lightweight OverrideRowInput rows — not real DB rows,
// since generation deliberately works against current, possibly-unsaved
// state (see module docstring). These builders fill in the truly-unused
// fields (id/collectionId/createdAt/etc. — never read by the resolver) with
// harmless placeholders, but pass reasonType through for real: it's what
// resolveAlgorithmicVenues/resolveAlgorithmicEvents (collectionsPreview.ts)
// use to distinguish a genuine manual add from a reorder/boost promotion
// row for the "Algorithmic" vs "Added manually" origin label.
// venueId/eventId/guideId/action/boost/sortOrder/reasonType are the fields
// that matter (sortOrder = array index, consistent with how
// replaceVenueOverrides/replaceEventOverrides/replaceGuideItems persist
// order at save time).

function toVenueOverridesForPreview(rows: OverrideRowInput[]): CollectionVenueOverride[] {
  return rows.map((r, i) => ({
    id: "", collectionId: "", venueId: r.id, venueName: null, action: r.action, boost: r.boost,
    sortOrder: i, reasonType: r.reasonType, note: null, createdAt: "", createdBy: null, updatedAt: "", updatedBy: null,
  }));
}

function toEventOverridesForPreview(rows: OverrideRowInput[]): CollectionEventOverride[] {
  return rows.map((r, i) => ({
    id: "", collectionId: "", eventId: r.id, eventTitle: null, action: r.action, boost: r.boost,
    sortOrder: i, reasonType: r.reasonType, note: null, createdAt: "", createdBy: null, updatedAt: "", updatedBy: null,
  }));
}

function toGuideItemsForPreview(guideIds: string[]): CollectionGuideItem[] {
  return guideIds.map((id, i) => ({
    id: "", collectionId: "", guideId: id, guideTitle: null, sortOrder: i,
    createdAt: "", createdBy: null, updatedAt: "", updatedBy: null,
  }));
}

// ── Create action ─────────────────────────────────────────────────────────────

export async function createCollectionAction(
  _prevState: CollectionFormState,
  formData: FormData
): Promise<CollectionFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const name = str(formData, "name");
  const description = nullableStr(formData, "description");
  const collectionType = str(formData, "collection_type");
  const marketId = str(formData, "market_id");
  const cityId = nullableStr(formData, "city_id");
  const algorithmKey = nullableStr(formData, "algorithm_key");
  // Always Draft on create — see module docstring. Never read from formData.
  const status: CollectionStatus = "draft";
  const { value: itemLimit, error: itemLimitError } = parseItemLimit(formData);

  const values: CollectionFormValues = { name, description, marketId, cityId, algorithmKey, itemLimit, status };

  const fieldErrors: CollectionFormState["fieldErrors"] = {};
  if (!name) fieldErrors.name = "Name is required.";
  if (!isCollectionType(collectionType)) fieldErrors.collection_type = "Select a Collection type.";
  if (!marketId) fieldErrors.market_id = "Market is required.";
  if (itemLimitError) fieldErrors.item_limit = itemLimitError;
  if (algorithmKey && !isAlgorithmKey(algorithmKey)) fieldErrors.algorithm_key = "Unsupported algorithm.";
  // Item limit is required for Algorithmic Collections on create (it drives
  // the automatic first generation below) — Manual/Guide Collections never
  // submit an algorithm_key, so this never fires for them. parseItemLimit()
  // itself still treats an empty value as merely optional (unchanged, since
  // updateCollectionAction's existing Algorithmic Collections may legitimately
  // have no item_limit yet) — this is an additional, create-only requirement.
  if (!itemLimitError && algorithmKey && isAlgorithmKey(algorithmKey) && itemLimit === null) {
    fieldErrors.item_limit = "Item limit is required for Algorithmic Collections.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Please fix the errors below.", fieldErrors, values };
  }

  const result = await createCollection(
    {
      name,
      description,
      collectionType: collectionType as CollectionType,
      marketId,
      cityId,
      status,
      algorithmKey,
      itemLimit,
    },
    callerEmail
  );

  if (!result.success) {
    return { error: result.error, values };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "collection_created",
    entityType: "collection",
    entityId: result.id,
    entityName: name,
  });

  revalidatePath("/control-panel/collections");
  // Anchor jumps the editor straight to the Resolved Collection section — for
  // a Manual Collection that's the content picker, for an Algorithmic
  // Collection that's the auto-resolved result the Edit page's own load
  // just produced (see CollectionForm.tsx's module docstring).
  redirect(`/control-panel/collections/${result.id}/edit?success=created#collection-content`);
}

// ── Update action ─────────────────────────────────────────────────────────────
// collectionId is bound via .bind(null, collectionId) — never read from FormData.

export async function updateCollectionAction(
  collectionId: string,
  _prevState: CollectionFormState,
  formData: FormData
): Promise<CollectionFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const existing = await getCollectionById(collectionId);
  if (!existing) return { error: "Collection not found." };

  const name = str(formData, "name");
  const description = nullableStr(formData, "description");
  const marketId = str(formData, "market_id");
  const cityId = nullableStr(formData, "city_id");
  const status = str(formData, "status") as CollectionStatus;

  // Curation Method, Algorithm, and Item Limit are locked after creation —
  // see module docstring. Always the stored values; formData is never
  // consulted for them, so the Edit form doesn't need to (and doesn't)
  // submit anything for these fields at all.
  const algorithmKey = existing.algorithmKey;
  const itemLimit = existing.itemLimit;

  const values: CollectionFormValues = { name, description, marketId, cityId, algorithmKey, itemLimit, status };

  const fieldErrors: CollectionFormState["fieldErrors"] = {};
  if (!name) fieldErrors.name = "Name is required.";
  if (!marketId) fieldErrors.market_id = "Market is required.";
  if (!COLLECTION_STATUSES.includes(status)) fieldErrors.status = "Select a status.";

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Please fix the errors below.", fieldErrors, values };
  }

  // ── Geography-change safety check ────────────────────────────────────────
  // updateCollection() re-validates city-belongs-to-market for the *new*
  // geography, but has no way to know whether *existing* membership rows
  // would become geographically invalid. Rather than silently orphaning or
  // partially clearing rows, block the geography change outright while any
  // membership exists — the safest option the task calls out. The admin can
  // remove membership first (Save with an empty membership list), then
  // change geography, then re-add geography-valid content.
  const geographyChanged = marketId !== existing.marketId || cityId !== existing.cityId;
  const hasMembership =
    existing.venueOverrides.length > 0 || existing.eventOverrides.length > 0 || existing.guideItems.length > 0;
  if (geographyChanged && hasMembership) {
    return {
      error:
        "This Collection has existing content membership. Remove all content from Resolved Collection below, " +
        "save, then change Market/City, then re-add geography-matching content.",
      values,
    };
  }

  // ── Publishing validation ────────────────────────────────────────────────
  // "At least one resolvable item where practical" — checked against what
  // will actually be saved (submitted membership rows), not stale DB state.
  // This runs BEFORE any write below, so a failed publish attempt never
  // touches the database — it cannot leave the Collection any different than
  // it was before the attempt (see module docstring's "Publish-failure
  // guarantee"). The submitted `status` (e.g. "published") is echoed back via
  // `values` so the form keeps showing what the admin chose, not a reverted
  // Draft.
  if (status === "published") {
    const venueRows = existing.collectionType === "venue" ? parseOverrideRows(formData, "venue_overrides") : [];
    const eventRows = existing.collectionType === "event" ? parseOverrideRows(formData, "event_overrides") : [];
    const guideIds = existing.collectionType === "guide" ? parseGuideRows(formData) : [];

    // algorithmKey/itemLimit are already the Collection's own stored, valid
    // values (see above) — no re-validation needed here, unlike before this
    // task when they came from the submitted form.
    const preview = await resolveCollectionPreview({
      collectionType: existing.collectionType,
      marketId,
      cityId,
      algorithmKey,
      itemLimit,
      venueOverrides: toVenueOverridesForPreview(venueRows),
      eventOverrides: toEventOverridesForPreview(eventRows),
      guideItems: toGuideItemsForPreview(guideIds),
    });

    if (preview.items.length === 0) {
      const reason = preview.emptyReason
        ? preview.emptyReason.charAt(0).toLowerCase() + preview.emptyReason.slice(1)
        : "it currently contains no eligible content.";
      return {
        error: `This Collection cannot be published because ${reason} Add content, choose a different algorithm, or save as Draft.`,
        values,
      };
    }
  }

  // algorithmKey/itemLimit are deliberately omitted from this patch — see
  // module docstring. updateCollection() only writes fields it's given
  // (undefined = untouched column), so the DB's algorithm_key/item_limit
  // columns are never written by an update, regardless of what was computed
  // above.
  const coreResult = await updateCollection(
    collectionId,
    { name, description, marketId, cityId, status },
    callerEmail
  );
  if (!coreResult.success) {
    return { error: coreResult.error, values };
  }

  // ── Membership replacement — only after the core write succeeds ──────────
  let membershipError: string | null = null;
  if (existing.collectionType === "venue") {
    const rows = parseOverrideRows(formData, "venue_overrides");
    const input: VenueOverrideInput[] = rows.map((r, i) => ({
      venueId: r.id, action: r.action, boost: r.boost, sortOrder: i, reasonType: r.reasonType,
    }));
    const result = await replaceVenueOverrides(collectionId, input, callerEmail);
    if (!result.success) membershipError = result.error;
  } else if (existing.collectionType === "event") {
    const rows = parseOverrideRows(formData, "event_overrides");
    const input: EventOverrideInput[] = rows.map((r, i) => ({
      eventId: r.id, action: r.action, boost: r.boost, sortOrder: i, reasonType: r.reasonType,
    }));
    const result = await replaceEventOverrides(collectionId, input, callerEmail);
    if (!result.success) membershipError = result.error;
  } else {
    const guideIds = parseGuideRows(formData);
    const input: GuideItemInput[] = guideIds.map((id, i) => ({ guideId: id, sortOrder: i }));
    const result = await replaceGuideItems(collectionId, input, callerEmail);
    if (!result.success) membershipError = result.error;
  }

  if (membershipError) {
    return {
      error:
        `Collection details were saved, but content membership failed to save: ${membershipError} ` +
        "Please review Resolved Collection below and save again.",
      values,
    };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "collection_updated",
    entityType: "collection",
    entityId: collectionId,
    entityName: name,
  });

  revalidatePath("/control-panel/collections");
  revalidatePath(`/control-panel/collections/${collectionId}/edit`);
  // No #collection-content anchor here (unlike the create redirect below) —
  // Save Changes is the end of the workflow (see CollectionForm's module
  // docstring), so landing back at the top next to the "Collection saved."
  // banner is expected, not a jump back down the page the admin just left.
  redirect(`/control-panel/collections/${collectionId}/edit?success=updated`);
}

// ── Content candidate search (venue / event) ─────────────────────────────────
//
// Reuses contentGuideAttachments.ts's searchVenueCandidates/searchEventCandidates
// verbatim (the same established selector already used by the Content Engine's
// AttachmentsSelector) — no new picker built from scratch. Collections have a
// stricter geography rule than guide attachments (which allow cross-market
// results ranked by tier): a Market Collection only accepts same-market
// content, a City Collection only accepts same-city content. That rule is
// enforced here by discarding any result whose matchTier doesn't meet the
// Collection's own geography, rather than by changing the shared search
// function's ranking behavior.

export type CollectionCandidateSearchInput = {
  marketId: string;
  cityId: string | null;
  query: string;
  excludeIds: string[];
};

function filterToCollectionGeography(
  results: AttachmentCandidate[],
  cityId: string | null
): AttachmentCandidate[] {
  if (cityId) {
    // City Collection — only same-city matches are acceptable.
    return results.filter((r) => r.matchTier === "city");
  }
  // Market Collection — same-market (or same-city, which is a subset of the
  // same market) matches are acceptable; "other" means a different market.
  return results.filter((r) => r.matchTier === "market" || r.matchTier === "city");
}

export async function searchCollectionVenueCandidatesAction(
  input: CollectionCandidateSearchInput
): Promise<AttachmentCandidate[]> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return [];
  if (!input.marketId) return [];
  const results = await searchVenueCandidates({
    marketId: input.marketId,
    cityId: input.cityId,
    neighbourhoodId: null,
    query: input.query,
    excludeIds: input.excludeIds,
  });
  return filterToCollectionGeography(results, input.cityId);
}

export async function searchCollectionEventCandidatesAction(
  input: CollectionCandidateSearchInput
): Promise<AttachmentCandidate[]> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return [];
  if (!input.marketId) return [];
  const results = await searchEventCandidates({
    marketId: input.marketId,
    cityId: input.cityId,
    neighbourhoodId: null,
    query: input.query,
    excludeIds: input.excludeIds,
  });
  return filterToCollectionGeography(results, input.cityId);
}

// ── Resolve for live editorial refinement ───────────────────────────────────
//
// Powers ResolvedCollectionTable.tsx's automatic re-resolution after an
// override edit (exclude/restore/boost/add/reorder) — not a standalone
// "Generate"/"Regenerate" action (removed; Algorithmic Collections are
// generated once, automatically, at creation — see CollectionForm.tsx's
// module docstring). Deliberately takes raw client state rather than
// reading the Collection from the database — resolveCollectionPreview()
// needs only market/city/algorithm/item-limit/overrides to run, so
// refinement works immediately after adding/excluding/boosting/reordering
// content, without requiring a prior Save. This is read-only: it never
// writes anything, so there is no risk of misleading or partial state from
// calling it freely.

export type GenerateCollectionInput = {
  collectionType: "venue" | "event";
  marketId: string;
  cityId: string | null;
  algorithmKey: string | null;
  itemLimit: number | null;
  overrides: OverrideRowInput[];
};

export type GenerateCollectionResult =
  | { success: true; preview: CollectionPreviewResult }
  | { success: false; error: string };

export async function generateCollectionResultAction(
  input: GenerateCollectionInput
): Promise<GenerateCollectionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };
  if (!input.marketId) return { success: false, error: "Select a Market first." };

  let algorithmKey: AlgorithmKey | null = null;
  if (input.algorithmKey) {
    if (!isAlgorithmKey(input.algorithmKey)) return { success: false, error: "Unsupported algorithm." };
    algorithmKey = input.algorithmKey;
  }

  const sanitizedRows = input.overrides
    .filter((r) => typeof r.id === "string" && r.id.length > 0)
    .map((r) => ({
      id: r.id,
      action: r.action === "exclude" ? ("exclude" as const) : ("include" as const),
      boost: typeof r.boost === "number" && Number.isFinite(r.boost) ? Math.max(0, Math.min(100, r.boost)) : 0,
      reasonType: typeof r.reasonType === "string" && r.reasonType.length > 0 ? r.reasonType : null,
    }));

  const preview = await resolveCollectionPreview({
    collectionType: input.collectionType,
    marketId: input.marketId,
    cityId: input.cityId,
    algorithmKey,
    itemLimit: input.itemLimit,
    venueOverrides: input.collectionType === "venue" ? toVenueOverridesForPreview(sanitizedRows) : [],
    eventOverrides: input.collectionType === "event" ? toEventOverridesForPreview(sanitizedRows) : [],
    guideItems: [],
  });

  return { success: true, preview };
}

// ── Archive / restore ─────────────────────────────────────────────────────────
//
// Archive lifecycle (migration 059) is deliberately separate from the
// editorial `status` field — see collections.archived_at's migration
// COMMENT for the full rationale. Archiving is blocked while the Collection
// is assigned to any Homepage Section; archiveCollection() (data layer) is
// the authoritative check (never trust only the client's already-rendered
// Homepage Usage card, which could be stale by the time this submits).
// Mirrors the isFaqInUse()-gated deleteFaqAction pattern (FAQ Library) — the
// explicit "in use" protection precedent this reuses, per product spec
// "Collection Usage & Deletion Protection".

export type ArchiveActionState = {
  error?: string;
  usageCount?: number;
  success?: true;
};

export async function archiveCollectionAction(
  collectionId: string,
  _prevState: ArchiveActionState,
  _formData: FormData
): Promise<ArchiveActionState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const existing = await getCollectionById(collectionId);
  if (!existing) return { error: "Collection not found." };

  const result = await archiveCollection(collectionId, callerEmail);
  if (!result.success) {
    return { error: result.error, usageCount: result.usage.entries.length };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "collection_archived",
    entityType: "collection",
    entityId: collectionId,
    entityName: existing.name,
  });

  revalidatePath("/control-panel/collections");
  revalidatePath(`/control-panel/collections/${collectionId}/edit`);
  redirect("/control-panel/collections?success=archived");
}

export async function restoreCollectionAction(
  collectionId: string,
  _prevState: ArchiveActionState,
  _formData: FormData
): Promise<ArchiveActionState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const existing = await getCollectionById(collectionId);
  if (!existing) return { error: "Collection not found." };

  const result = await restoreCollection(collectionId, callerEmail);
  if (!result.success) return { error: result.error };

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "collection_restored",
    entityType: "collection",
    entityId: collectionId,
    entityName: existing.name,
  });

  revalidatePath("/control-panel/collections");
  revalidatePath(`/control-panel/collections/${collectionId}/edit`);
  return { success: true };
}
