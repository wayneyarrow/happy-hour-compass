"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import {
  createHomepage,
  updateHomepage,
  getHomepageById,
  getHomepageFormGeography,
  createHomepageSection,
  updateHomepageSectionContent,
  deleteHomepageSection,
  updateHomepageSectionOrder,
  type HomepageStatus,
  type HomepageSection,
  type HomepageSectionType,
  type HomepageSectionContentMode,
} from "@/lib/data/homepages";
import { homepageDisplayName } from "@/lib/seo/homepageSeo";
import { searchVenueCandidates, searchEventCandidates, type AttachmentCandidate } from "@/lib/data/contentGuideAttachments";

/**
 * Server actions for Homepage Management V1 + the Homepage Sections editor
 * (docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md; Section-editor task).
 * Mirrors the create/update action pattern already used by
 * collections/actions.ts — every action independently re-checks CP admin
 * access.
 *
 * createHomepageAction always writes status = "draft", regardless of what
 * (if anything) the client submitted — the create page never renders a
 * Status control (see HomepageForm's module docstring), matching
 * createCollectionAction's identical guarantee. Publishing is a decision
 * made on the Edit page, after Sections and SEO are in place.
 *
 * A new Homepage now starts with zero Sections (plain createHomepage(), not
 * the earlier createHomepageWithDefaultTemplate() three-slot auto-template).
 * The Homepage Sections editor's own "begins with [Add Section]" / empty
 * state (HomepageSectionsEditor.tsx) replaces that rigid template — an
 * editor now assembles Sections top-down, one at a time, choosing from six
 * real Section Types (Venue/Event/Guide Collection or Feature) rather than
 * starting from three fixed, always-unassigned slots. This is a deliberate
 * behavior change from the previous Homepage Management task — see the
 * Homepage Sections editor task's implementation summary for the full
 * rationale.
 *
 * Homepage Name is never read from formData — there is no `name` input in
 * HomepageForm at all. Both actions independently derive it via
 * computeHomepageName() from the submitted market_id/city_id, so the
 * "system-generated, not editable" rule is enforced server-side, not just
 * hidden in the UI (the same guarantee createCollectionAction gives Status
 * on create).
 *
 * updateHomepageAction blocks a Market/City change while any of the
 * Homepage's Sections already carries assigned content (a Collection, or a
 * Feature Venue/Event/Guide) — that content's geography compatibility was
 * validated against the Homepage's *current* geography
 * (isCollectionAssignableToHomepage / validateSectionContentAssignment in
 * homepages.ts), so silently reassigning the Homepage's own geography out
 * from under it would leave a stale, unvalidated assignment. The admin can
 * remove the Section's content (or the Section itself) first, then change
 * Market/City, mirroring updateCollectionAction's identical
 * "geography-change safety check" for Collection membership.
 *
 * ── Homepage Sections editor actions ─────────────────────────────────────
 *
 * createSectionAction / updateSectionAction / removeSectionAction /
 * moveSectionAction are plain async functions (not useActionState-bound
 * <form> actions) — the Sections editor is an independently-interactive
 * mini-CRUD area nested inside HomepageForm's outer <form>, the same way
 * ResolvedCollectionTable.tsx's override editing calls
 * generateCollectionResultAction directly via startTransition rather than
 * submitting the parent form. Every one of these returns the Homepage's
 * complete, freshly-reloaded Section list on success (not just the mutated
 * row) — the row count is always small, so refetching the whole list after
 * every mutation is cheap and removes any risk of the client's local state
 * ever drifting from the database.
 *
 * Duplicate-content and geography validation happen in
 * validateSectionContentAssignment (homepages.ts) on every create/update —
 * the "Already used on this Homepage" UI graying in
 * HomepageSectionsEditor.tsx is a responsive guide only, never the source
 * of truth.
 */

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getCallerEmail(): Promise<string | null> {
  try {
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user?.email) return null;
    if (!(await isControlPanelAdmin(user.email))) return null;
    return user.email;
  } catch {
    return null;
  }
}

// ── Form state ────────────────────────────────────────────────────────────────

export type HomepageFieldKey = "market_id" | "city_id" | "status";

/** Echoed back on a failed submit so the form can re-display exactly what was attempted — see module docstring. */
export type HomepageFormValues = {
  marketId: string;
  cityId: string | null;
  status: HomepageStatus;
  pageTitle: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  canonicalUrl: string | null;
};

export type HomepageFormState = {
  error?: string;
  fieldErrors?: Partial<Record<HomepageFieldKey, string>>;
  values?: HomepageFormValues;
};

const HOMEPAGE_STATUSES: HomepageStatus[] = ["draft", "published"];

// ── Parsing helpers ───────────────────────────────────────────────────────────

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function nullableStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length > 0 ? v : null;
}

function seoValues(formData: FormData): Pick<
  HomepageFormValues,
  "pageTitle" | "metaTitle" | "metaDescription" | "ogTitle" | "ogDescription" | "canonicalUrl"
> {
  return {
    pageTitle: nullableStr(formData, "page_title"),
    metaTitle: nullableStr(formData, "meta_title"),
    metaDescription: nullableStr(formData, "meta_description"),
    ogTitle: nullableStr(formData, "og_title"),
    ogDescription: nullableStr(formData, "og_description"),
    canonicalUrl: nullableStr(formData, "canonical_url"),
  };
}

/**
 * Derives the system-generated Homepage name from geography — the sole
 * source of `homepages.name`, both on create and on every update (including
 * one that changes Market/City). Returns a field error keyed to market_id /
 * city_id if either id doesn't resolve to a real row, rather than silently
 * falling back to an empty/partial name.
 */
type NameResult = { name: string; error?: never } | { name?: never; error: { field: "market_id" | "city_id"; message: string } };

async function computeHomepageName(marketId: string, cityId: string | null): Promise<NameResult> {
  const { markets, cities } = await getHomepageFormGeography();

  const market = markets.find((m) => m.id === marketId);
  if (!market) return { error: { field: "market_id", message: "Market not found." } };

  let cityName: string | null = null;
  if (cityId) {
    const city = cities.find((c) => c.id === cityId);
    if (!city) return { error: { field: "city_id", message: "City not found." } };
    cityName = city.name;
  }

  return { name: homepageDisplayName(market.name, cityName) };
}

// ── Create action ─────────────────────────────────────────────────────────────

export async function createHomepageAction(
  _prevState: HomepageFormState,
  formData: FormData
): Promise<HomepageFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const marketId = str(formData, "market_id");
  const cityId = nullableStr(formData, "city_id");
  // Always Draft on create — see module docstring. Never read from formData.
  const status: HomepageStatus = "draft";
  const seo = seoValues(formData);

  const values: HomepageFormValues = { marketId, cityId, status, ...seo };

  const fieldErrors: HomepageFormState["fieldErrors"] = {};
  if (!marketId) fieldErrors.market_id = "Market is required.";

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Please fix the errors below.", fieldErrors, values };
  }

  const nameResult = await computeHomepageName(marketId, cityId);
  if (nameResult.error) {
    return {
      error: nameResult.error.message,
      fieldErrors: { [nameResult.error.field]: nameResult.error.message },
      values,
    };
  }

  // Empty-state creation — no default template. See module docstring.
  const result = await createHomepage(
    { name: nameResult.name, marketId, cityId, status, ...seo },
    callerEmail
  );

  if (!result.success) {
    return { error: result.error, values };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "homepage_created",
    entityType: "homepage",
    entityId: result.id,
    entityName: nameResult.name,
  });

  revalidatePath("/control-panel/homepages");
  // Anchor jumps the editor straight to Homepage Sections — the next
  // logical working area. See HomepageForm's module docstring for the
  // matching scrollToSectionsOnMount JS-driven smooth-scroll.
  redirect(`/control-panel/homepages/${result.id}/edit?success=created#homepage-sections`);
}

// ── Update action ─────────────────────────────────────────────────────────────
// homepageId is bound via .bind(null, homepageId) — never read from FormData.

export async function updateHomepageAction(
  homepageId: string,
  _prevState: HomepageFormState,
  formData: FormData
): Promise<HomepageFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const existing = await getHomepageById(homepageId);
  if (!existing) return { error: "Homepage not found." };

  const marketId = str(formData, "market_id");
  const cityId = nullableStr(formData, "city_id");
  const status = str(formData, "status") as HomepageStatus;
  const seo = seoValues(formData);

  const values: HomepageFormValues = { marketId, cityId, status, ...seo };

  const fieldErrors: HomepageFormState["fieldErrors"] = {};
  if (!marketId) fieldErrors.market_id = "Market is required.";
  if (!HOMEPAGE_STATUSES.includes(status)) fieldErrors.status = "Select a status.";

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Please fix the errors below.", fieldErrors, values };
  }

  // ── Geography-change safety check — see module docstring ────────────────
  const geographyChanged = marketId !== existing.marketId || cityId !== existing.cityId;
  const hasAssignedSections = existing.sections.some(
    (s) => s.collectionId !== null || s.venueId !== null || s.eventId !== null || s.guideId !== null
  );
  if (geographyChanged && hasAssignedSections) {
    return {
      error:
        "This Homepage has Sections with assigned content. Remove that content first, then change Market/City.",
      values,
    };
  }

  const nameResult = await computeHomepageName(marketId, cityId);
  if (nameResult.error) {
    return {
      error: nameResult.error.message,
      fieldErrors: { [nameResult.error.field]: nameResult.error.message },
      values,
    };
  }

  const result = await updateHomepage(
    homepageId,
    { name: nameResult.name, marketId, cityId, status, ...seo },
    callerEmail
  );
  if (!result.success) {
    return { error: result.error, values };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "homepage_updated",
    entityType: "homepage",
    entityId: homepageId,
    entityName: nameResult.name,
  });

  revalidatePath("/control-panel/homepages");
  revalidatePath(`/control-panel/homepages/${homepageId}/edit`);
  redirect(`/control-panel/homepages/${homepageId}/edit?success=updated`);
}

// ── Homepage Sections editor — content search ───────────────────────────────
//
// Reuses contentGuideAttachments.ts's searchVenueCandidates/searchEventCandidates
// verbatim (the same established selector already used by Collections' own
// Feature-equivalent content search — see collections/actions.ts's identical
// filterToCollectionGeography). Unlike that Collections picker (which
// excludes already-selected ids entirely, since Collections allow multi-item
// membership), results here are never excluded for being already used
// elsewhere on the Homepage — the product spec requires those to remain
// visible, just disabled ("Already used on this Homepage"), which
// HomepageSectionsEditor.tsx computes client-side from the Homepage's own
// already-loaded Section list.

export type FeatureSearchInput = {
  marketId: string;
  cityId: string | null;
  query: string;
};

function filterToHomepageGeography(results: AttachmentCandidate[], cityId: string | null): AttachmentCandidate[] {
  if (cityId) {
    // City Homepage — only same-city matches are eligible Features.
    return results.filter((r) => r.matchTier === "city");
  }
  // Market Homepage — same-market (or same-city, a subset) matches are eligible.
  return results.filter((r) => r.matchTier === "market" || r.matchTier === "city");
}

export async function searchHomepageVenueFeatureCandidatesAction(
  input: FeatureSearchInput
): Promise<AttachmentCandidate[]> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return [];
  if (!input.marketId) return [];
  const results = await searchVenueCandidates({
    marketId: input.marketId,
    cityId: input.cityId,
    neighbourhoodId: null,
    query: input.query,
  });
  return filterToHomepageGeography(results, input.cityId);
}

export async function searchHomepageEventFeatureCandidatesAction(
  input: FeatureSearchInput
): Promise<AttachmentCandidate[]> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return [];
  if (!input.marketId) return [];
  const results = await searchEventCandidates({
    marketId: input.marketId,
    cityId: input.cityId,
    neighbourhoodId: null,
    query: input.query,
  });
  return filterToHomepageGeography(results, input.cityId);
}

// ── Homepage Sections editor — Section CRUD ─────────────────────────────────

export type SectionActionResult =
  | { success: true; sections: HomepageSection[] }
  | { success: false; error: string };

async function reloadSections(homepageId: string): Promise<HomepageSection[]> {
  const homepage = await getHomepageById(homepageId);
  return homepage?.sections ?? [];
}

export type SectionContentActionInput = {
  collectionId: string | null;
  venueId: string | null;
  eventId: string | null;
  guideId: string | null;
};

export type CreateSectionActionInput = SectionContentActionInput & {
  sectionType: HomepageSectionType;
  contentMode: HomepageSectionContentMode;
  title: string;
};

export async function createSectionAction(
  homepageId: string,
  input: CreateSectionActionInput
): Promise<SectionActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const result = await createHomepageSection(homepageId, input, callerEmail);
  if (!result.success) return { success: false, error: result.error };

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "homepage_section_created",
    entityType: "homepage_section",
    entityId: result.id,
    entityName: input.title,
  });

  revalidatePath(`/control-panel/homepages/${homepageId}/edit`);
  return { success: true, sections: await reloadSections(homepageId) };
}

export type UpdateSectionActionInput = SectionContentActionInput & {
  title: string;
};

export async function updateSectionAction(
  homepageId: string,
  sectionId: string,
  input: UpdateSectionActionInput
): Promise<SectionActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const result = await updateHomepageSectionContent(sectionId, input, callerEmail);
  if (!result.success) return { success: false, error: result.error };

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "homepage_section_updated",
    entityType: "homepage_section",
    entityId: sectionId,
    entityName: input.title,
  });

  revalidatePath(`/control-panel/homepages/${homepageId}/edit`);
  return { success: true, sections: await reloadSections(homepageId) };
}

/** Removes a Section from the Homepage only — never the underlying Collection/Venue/Event/Guide (see deleteHomepageSection's doc comment). A simple confirm() in the client gates this before it's ever called. */
export async function removeSectionAction(
  homepageId: string,
  sectionId: string
): Promise<SectionActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const homepage = await getHomepageById(homepageId);
  const removedTitle = homepage?.sections.find((s) => s.id === sectionId)?.title ?? null;

  const result = await deleteHomepageSection(homepageId, sectionId);
  if (!result.success) return { success: false, error: result.error };

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "homepage_section_removed",
    entityType: "homepage_section",
    entityId: sectionId,
    entityName: removedTitle,
  });

  revalidatePath(`/control-panel/homepages/${homepageId}/edit`);
  return { success: true, sections: await reloadSections(homepageId) };
}

/** Move Up / Move Down — swaps the Section with its adjacent neighbour and persists via the existing updateHomepageSectionOrder (reassigns display_order 0..n-1). A no-op (returns current state, not an error) if already at the boundary — the client-side disabled state on the first/last row's button is the primary guard; this is the server-side backstop. */
export async function moveSectionAction(
  homepageId: string,
  sectionId: string,
  direction: "up" | "down"
): Promise<SectionActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const homepage = await getHomepageById(homepageId);
  if (!homepage) return { success: false, error: "Homepage not found." };

  const ordered = [...homepage.sections].sort((a, b) => a.displayOrder - b.displayOrder);
  const index = ordered.findIndex((s) => s.id === sectionId);
  if (index === -1) return { success: false, error: "Section not found." };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= ordered.length) {
    return { success: true, sections: homepage.sections };
  }

  const reordered = [...ordered];
  [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

  const result = await updateHomepageSectionOrder(homepageId, reordered.map((s) => s.id), callerEmail);
  if (!result.success) return { success: false, error: result.error };

  revalidatePath(`/control-panel/homepages/${homepageId}/edit`);
  return { success: true, sections: await reloadSections(homepageId) };
}
