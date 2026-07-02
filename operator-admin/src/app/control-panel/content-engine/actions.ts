"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import type { GuideType, GuideStatus } from "@/lib/data/contentGuides";

/**
 * Create/update server actions for the Content Engine guide form (Card 2).
 *
 * Scope: basic CRUD for content_guides only. No venue/event attachments, no
 * SEO generation, no scheduling/expiry automation — those are later cards.
 * See docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type GuideFieldKey =
  | "guide_type" | "market_id" | "city_id" | "title" | "slug"
  | "status" | "publish_at" | "expire_at";

export type GuideFormState = {
  error?: string;
  fieldErrors?: Partial<Record<GuideFieldKey, string>>;
};

const GUIDE_TYPES: GuideType[] = ["venue_guide", "event_guide"];
const GUIDE_STATUSES: GuideStatus[] = ["draft", "scheduled", "published", "expired"];
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
  publish_at: string | null;
  expire_at: string | null;
};

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function nullableStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length > 0 ? v : null;
}

function parseSecondaryKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/** Converts a datetime-local input value ("YYYY-MM-DDTHH:mm") to an ISO string, or null. */
function toIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
    publish_at:          toIso(nullableStr(formData, "publish_at")),
    expire_at:           toIso(nullableStr(formData, "expire_at")),
  };
}

/**
 * Validates the required fields listed in the Card 2 spec:
 *   guide_type, market, city, title, slug, status required;
 *   publish_at required only when status = 'scheduled';
 *   expire_at must be after publish_at when both are provided.
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
  if (parsed.status === "scheduled" && !parsed.publish_at) {
    errors.publish_at = "Publish date is required when status is Scheduled.";
  }
  if (parsed.publish_at && parsed.expire_at) {
    if (new Date(parsed.expire_at).getTime() <= new Date(parsed.publish_at).getTime()) {
      errors.expire_at = "Expiry date must be after the publish date.";
    }
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
      publish_at:           parsed.publish_at,
      expire_at:            parsed.expire_at,
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

  await logAuditEvent({
    actorEmail: callerEmail,
    action:     "content_guide_created",
    entityType: "content_guide",
    entityId:   (inserted as { id: string }).id,
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
      publish_at:           parsed.publish_at,
      expire_at:            parsed.expire_at,
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
