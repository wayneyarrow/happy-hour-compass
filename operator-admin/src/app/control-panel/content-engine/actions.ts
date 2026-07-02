"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import type { GuideType, GuideStatus } from "@/lib/data/contentGuides";
import {
  saveGuideAttachments,
  searchVenueCandidates,
  searchEventCandidates,
  type AttachmentCandidate,
} from "@/lib/data/contentGuideAttachments";
import { saveGuideChannels } from "@/lib/data/contentGuideDistribution";

/**
 * Create/update server actions for the Content Engine guide form (Card 2 +
 * Card 3 attachments + Card 4 SEO fields + Card 6B distribution eligibility
 * + Card 7 status simplification).
 *
 * Scope: CRUD for content_guides (including its SEO columns — page_title,
 * meta_title, meta_description, og_title, og_description, canonical_url —
 * added in migration 054) plus its venue/event attachments
 * (content_guide_venues / content_guide_events) and its distribution
 * channel eligibility (content_guide_channels, migration 055). SEO values
 * themselves are generated client-side in GuideForm via
 * src/lib/seo/contentGuideSeo.ts; this file just persists whatever ends up
 * in those form fields, same as any other guide field — no server-side SEO
 * generation or validation blocking. Distribution here is eligibility only
 * (editorial intent) — actual merchandising/placement is Discover
 * Management's job (see content-engine's sibling discover/guides/actions.ts).
 *
 * Status is now binary (draft/published) — Card 7 removed scheduled/expired
 * from the V1 editorial workflow, along with the publish_at/expire_at inputs
 * that only existed to support "scheduled" (see removed toIso() and the old
 * cross-field date validation, both deleted rather than kept dead). Those
 * two columns still exist in the DB and are still read by public rendering's
 * publish-window check (isGuidePublicNow in contentGuides.ts) — this file
 * just no longer writes to them, so pre-existing values are left untouched
 * rather than overwritten with null on the next save.
 *
 * No FAQ/related guides — those are later cards. See
 * docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type GuideFieldKey =
  | "guide_type" | "market_id" | "city_id" | "title" | "slug" | "status";

export type GuideFormState = {
  error?: string;
  fieldErrors?: Partial<Record<GuideFieldKey, string>>;
};

const GUIDE_TYPES: GuideType[] = ["venue_guide", "event_guide"];
const GUIDE_STATUSES: GuideStatus[] = ["draft", "published"];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ── Auth helper ───────────────────────────────────────────────────────────────
// Mirrors the pattern in discover/actions.ts and platform-admins/actions.ts —
// every action independently verifies CP admin access (never trusts that the
// page gate alone protected the request).

async function getCallerEmail(): Promise<string | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user?.email) return null;
    if (!await isControlPanelAdmin(user.email)) return null;
    return user.email;
  } catch {
    return null;
  }
}

// ── Parsing + validation ──────────────────────────────────────────────────────

type ParsedGuide = {
  guide_type: string;
  status: string;
  market_id: string;
  city_id: string;
  neighbourhood_id: string | null;
  title: string;
  slug: string;
  primary_keyword: string | null;
  secondary_keywords: string[];
  intro: string | null;
  body: string | null;
  hero_image_url: string | null;
  page_title: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_title: string | null;
  og_description: string | null;
  canonical_url: string | null;
};

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function nullableStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length > 0 ? v : null;
}

/** Reads the ordered, comma-separated list of attachment ids from the hidden
 * "attachment_ids" input the AttachmentsSelector maintains inside the form. */
function parseAttachmentIds(formData: FormData): string[] {
  const raw = str(formData, "attachment_ids");
  return raw.length > 0 ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Reads the comma-separated list of eligible distribution channel keys from
 * the hidden "distribution_channels" input the Distribution section maintains. */
function parseDistributionChannels(formData: FormData): string[] {
  const raw = str(formData, "distribution_channels");
  return raw.length > 0 ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function parseSecondaryKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

function parseGuideForm(formData: FormData): ParsedGuide {
  return {
    guide_type:         str(formData, "guide_type"),
    status:              str(formData, "status"),
    market_id:           str(formData, "market_id"),
    city_id:             str(formData, "city_id"),
    neighbourhood_id:    nullableStr(formData, "neighbourhood_id"),
    title:               str(formData, "title"),
    slug:                str(formData, "slug").toLowerCase(),
    primary_keyword:     nullableStr(formData, "primary_keyword"),
    secondary_keywords:  parseSecondaryKeywords(str(formData, "secondary_keywords")),
    intro:               nullableStr(formData, "intro"),
    body:                nullableStr(formData, "body"),
    hero_image_url:      nullableStr(formData, "hero_image_url"),
    page_title:          nullableStr(formData, "page_title"),
    meta_title:          nullableStr(formData, "meta_title"),
    meta_description:    nullableStr(formData, "meta_description"),
    og_title:            nullableStr(formData, "og_title"),
    og_description:      nullableStr(formData, "og_description"),
    canonical_url:       nullableStr(formData, "canonical_url"),
  };
}

/**
 * Validates the required fields: guide_type, market, city, title, slug,
 * status. Status is binary (draft/published) as of Card 7 — there is no
 * more cross-field date validation, since scheduling/expiry no longer
 * exist in the editor.
 */
function validateGuideForm(parsed: ParsedGuide): Partial<Record<GuideFieldKey, string>> {
  const errors: Partial<Record<GuideFieldKey, string>> = {};

  if (!GUIDE_TYPES.includes(parsed.guide_type as GuideType)) {
    errors.guide_type = "Select a guide type.";
  }
  if (!parsed.market_id) {
    errors.market_id = "Market is required.";
  }
  if (!parsed.city_id) {
    errors.city_id = "City is required.";
  }
  if (!parsed.title) {
    errors.title = "Title is required.";
  }
  if (!parsed.slug) {
    errors.slug = "Slug is required.";
  } else if (!SLUG_PATTERN.test(parsed.slug)) {
    errors.slug = "Slug can only contain lowercase letters, numbers, and hyphens.";
  }
  if (!GUIDE_STATUSES.includes(parsed.status as GuideStatus)) {
    errors.status = "Select a status.";
  }

  return errors;
}

// ── Create action ─────────────────────────────────────────────────────────────

export async function createGuideAction(
  _prevState: GuideFormState,
  formData: FormData
): Promise<GuideFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const parsed = parseGuideForm(formData);
  const fieldErrors = validateGuideForm(parsed);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Please fix the errors below.", fieldErrors };
  }

  const supabase = createAdminClient();
  const { data: inserted, error } = await supabase
    .from("content_guides")
    .insert({
      guide_type:          parsed.guide_type,
      status:               parsed.status,
      market_id:            parsed.market_id,
      city_id:              parsed.city_id,
      neighbourhood_id:     parsed.neighbourhood_id,
      title:                parsed.title,
      slug:                 parsed.slug,
      primary_keyword:      parsed.primary_keyword,
      secondary_keywords:   parsed.secondary_keywords,
      intro:                parsed.intro,
      body:                 parsed.body,
      hero_image_url:       parsed.hero_image_url,
      page_title:           parsed.page_title,
      meta_title:           parsed.meta_title,
      meta_description:     parsed.meta_description,
      og_title:             parsed.og_title,
      og_description:       parsed.og_description,
      canonical_url:        parsed.canonical_url,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    if (error?.code === "23505") {
      return {
        error: "Please fix the errors below.",
        fieldErrors: { slug: "This slug is already used by another guide in this market." },
      };
    }
    console.error("[createGuideAction] Insert error:", error?.message);
    return { error: "Failed to create guide. Please try again." };
  }

  const guideId = (inserted as { id: string }).id;

  await saveGuideAttachments(
    guideId,
    parsed.guide_type as GuideType,
    parseAttachmentIds(formData)
  );
  await saveGuideChannels(guideId, parseDistributionChannels(formData));

  await logAuditEvent({
    actorEmail: callerEmail,
    action:     "content_guide_created",
    entityType: "content_guide",
    entityId:   guideId,
    entityName: parsed.title,
  });

  revalidatePath("/control-panel/content-engine");
  redirect("/control-panel/content-engine?success=created");
}

// ── Update action ─────────────────────────────────────────────────────────────
// guideId is bound via .bind(null, guideId) — never read from FormData.

export async function updateGuideAction(
  guideId: string,
  _prevState: GuideFormState,
  formData: FormData
): Promise<GuideFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const parsed = parseGuideForm(formData);
  const fieldErrors = validateGuideForm(parsed);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Please fix the errors below.", fieldErrors };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("content_guides")
    .update({
      guide_type:          parsed.guide_type,
      status:               parsed.status,
      market_id:            parsed.market_id,
      city_id:              parsed.city_id,
      neighbourhood_id:     parsed.neighbourhood_id,
      title:                parsed.title,
      slug:                 parsed.slug,
      primary_keyword:      parsed.primary_keyword,
      secondary_keywords:   parsed.secondary_keywords,
      intro:                parsed.intro,
      body:                 parsed.body,
      hero_image_url:       parsed.hero_image_url,
      page_title:           parsed.page_title,
      meta_title:           parsed.meta_title,
      meta_description:     parsed.meta_description,
      og_title:             parsed.og_title,
      og_description:       parsed.og_description,
      canonical_url:        parsed.canonical_url,
    })
    .eq("id", guideId);

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Please fix the errors below.",
        fieldErrors: { slug: "This slug is already used by another guide in this market." },
      };
    }
    console.error("[updateGuideAction] Update error:", error.message);
    return { error: "Failed to save changes. Please try again." };
  }

  await saveGuideAttachments(
    guideId,
    parsed.guide_type as GuideType,
    parseAttachmentIds(formData)
  );
  await saveGuideChannels(guideId, parseDistributionChannels(formData));

  await logAuditEvent({
    actorEmail: callerEmail,
    action:     "content_guide_updated",
    entityType: "content_guide",
    entityId:   guideId,
    entityName: parsed.title,
  });

  revalidatePath("/control-panel/content-engine");
  revalidatePath(`/control-panel/content-engine/${guideId}/edit`);
  redirect("/control-panel/content-engine?success=updated");
}

// ── Attachment candidate search ──────────────────────────────────────────────
// Called directly from AttachmentsSelector (a client component) via
// useTransition — same "use server" function-call pattern as
// discover/actions.ts's addToRailAction / addEventToRailAction. Each action
// independently re-checks CP admin access; a signed-out or non-admin caller
// gets an empty result set rather than an error, since this only ever backs
// a search-as-you-type dropdown.

export type AttachmentSearchInput = {
  marketId: string;
  cityId: string | null;
  neighbourhoodId: string | null;
  query: string;
  excludeIds: string[];
};

export async function searchVenueAttachmentCandidatesAction(
  input: AttachmentSearchInput
): Promise<AttachmentCandidate[]> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return [];
  if (!input.marketId) return [];
  return searchVenueCandidates(input);
}

export async function searchEventAttachmentCandidatesAction(
  input: AttachmentSearchInput
): Promise<AttachmentCandidate[]> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return [];
  if (!input.marketId) return [];
  return searchEventCandidates(input);
}
