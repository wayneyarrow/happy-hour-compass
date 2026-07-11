"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import {
  createHomepageWithDefaultTemplate,
  updateHomepage,
  getHomepageById,
  getHomepageFormGeography,
  type HomepageStatus,
} from "@/lib/data/homepages";
import { homepageDisplayName } from "@/lib/seo/homepageSeo";

/**
 * Server actions for Homepage Management V1
 * (docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md). Mirrors the
 * create/update action pattern already used by collections/actions.ts —
 * every action independently re-checks CP admin access.
 *
 * createHomepageAction always writes status = "draft", regardless of what
 * (if anything) the client submitted — the create page never renders a
 * Status control (see HomepageForm's module docstring), matching
 * createCollectionAction's identical guarantee. Publishing is a decision
 * made on the Edit page, after Sections and SEO are in place.
 *
 * createHomepageAction seeds the standard V1 template (Featured Venues /
 * Featured Events / Featured Guides, each unassigned) via
 * createHomepageWithDefaultTemplate() — editors never start from a blank
 * Homepage (see HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md "Homepage Templates").
 * Assigning Collections to those Sections is out of scope for this task —
 * see HomepageForm.tsx's "Homepage Sections" placeholder card.
 *
 * Homepage Name is never read from formData — there is no `name` input in
 * HomepageForm at all. Both actions independently derive it via
 * computeHomepageName() from the submitted market_id/city_id, so the
 * "system-generated, not editable" rule is enforced server-side, not just
 * hidden in the UI (the same guarantee createCollectionAction gives Status
 * on create).
 *
 * updateHomepageAction blocks a Market/City change while any of the
 * Homepage's Sections already carries an assigned Collection — that
 * Collection's geography compatibility was validated against the Homepage's
 * *current* geography (isCollectionAssignableToHomepage /
 * validateSectionCollectionAssignment in homepages.ts), so silently
 * reassigning the Homepage's own geography out from under it would leave a
 * stale, unvalidated assignment. This task builds no Section editor, so no
 * Section can currently acquire a Collection through the admin UI — but the
 * guard is the correct enforcement point regardless of which future editor
 * (or direct data-layer call) puts a Section into that state, mirroring
 * updateCollectionAction's identical "geography-change safety check" for
 * Collection membership.
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

  const result = await createHomepageWithDefaultTemplate(
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
  const hasAssignedSections = existing.sections.some((s) => s.collectionId !== null);
  if (geographyChanged && hasAssignedSections) {
    return {
      error:
        "This Homepage has Sections with an assigned Collection. Unassign them first, then change Market/City.",
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
