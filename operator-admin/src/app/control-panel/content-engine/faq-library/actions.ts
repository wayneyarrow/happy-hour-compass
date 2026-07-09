"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import { isFaqInUse, type FaqAppliesTo } from "@/lib/data/faqLibrary";

/**
 * Create/update/enable-disable/delete server actions for the FAQ Library
 * (Card 2C). Mirrors the actions.ts convention used by
 * content-engine/actions.ts and platform-admins/actions.ts — every action
 * independently re-checks CP admin access, never trusting that the page
 * gate alone protected the request.
 *
 * Guide↔FAQ answer writes (content_guide_faqs) are NOT here — those are
 * part of the guide form and live in ../actions.ts alongside
 * createGuideAction/updateGuideAction, via saveGuideFaqs()
 * (src/lib/data/faqLibrary.ts).
 */

export type FaqFormState = {
  error?: string;
  success?: true;
};

const APPLIES_TO_VALUES: FaqAppliesTo[] = ["venue", "event", "both"];

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

function parseFaqForm(formData: FormData) {
  const question = ((formData.get("question") as string | null) ?? "").trim();
  const categoryRaw = ((formData.get("category") as string | null) ?? "").trim();
  const appliesToRaw = (formData.get("applies_to") as string | null) ?? "both";
  const sortOrderRaw = (formData.get("sort_order") as string | null) ?? "0";
  const sortOrder = Number.parseInt(sortOrderRaw, 10);

  return {
    question,
    category: categoryRaw.length > 0 ? categoryRaw : null,
    applies_to: APPLIES_TO_VALUES.includes(appliesToRaw as FaqAppliesTo)
      ? (appliesToRaw as FaqAppliesTo)
      : "both",
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

// ── Create ─────────────────────────────────────────────────────────────────────

export async function createFaqAction(
  _prevState: FaqFormState,
  formData: FormData
): Promise<FaqFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const parsed = parseFaqForm(formData);
  if (!parsed.question) return { error: "Question is required." };

  const supabase = createAdminClient();
  const { data: inserted, error } = await supabase
    .from("faq_library")
    .insert(parsed)
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[createFaqAction] Insert error:", error?.message);
    return { error: "Failed to create question. Please try again." };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "faq_library_created",
    entityType: "faq_library",
    entityId: (inserted as { id: string }).id,
    entityName: parsed.question,
  });

  revalidatePath("/control-panel/content-engine/faq-library");
  return { success: true };
}

// ── Update ─────────────────────────────────────────────────────────────────────
// faqId is bound via .bind(null, faqId) — never read from FormData.

export async function updateFaqAction(
  faqId: string,
  _prevState: FaqFormState,
  formData: FormData
): Promise<FaqFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const parsed = parseFaqForm(formData);
  if (!parsed.question) return { error: "Question is required." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("faq_library")
    .update(parsed)
    .eq("id", faqId);

  if (error) {
    console.error("[updateFaqAction] Update error:", error.message);
    return { error: "Failed to save changes. Please try again." };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "faq_library_updated",
    entityType: "faq_library",
    entityId: faqId,
    entityName: parsed.question,
  });

  revalidatePath("/control-panel/content-engine/faq-library");
  return { success: true };
}

// ── Enable / disable ─────────────────────────────────────────────────────────
// faqId + nextActive are both bound via .bind(null, faqId, nextActive).

export async function setFaqActiveAction(
  faqId: string,
  nextActive: boolean,
  _prevState: FaqFormState,
  _formData: FormData
): Promise<FaqFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("faq_library")
    .update({ active: nextActive })
    .eq("id", faqId);

  if (error) {
    console.error("[setFaqActiveAction] Update error:", error.message);
    return { error: "Failed to update status. Please try again." };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: nextActive ? "faq_library_enabled" : "faq_library_disabled",
    entityType: "faq_library",
    entityId: faqId,
    entityName: faqId,
  });

  revalidatePath("/control-panel/content-engine/faq-library");
  return { success: true };
}

// ── Delete (only if unused) ────────────────────────────────────────────────────

export async function deleteFaqAction(
  faqId: string,
  _prevState: FaqFormState,
  _formData: FormData
): Promise<FaqFormState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  if (await isFaqInUse(faqId)) {
    return {
      error: "This question is used by one or more guides and can't be deleted. Disable it instead.",
    };
  }

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("faq_library")
    .select("question")
    .eq("id", faqId)
    .maybeSingle();

  const { error } = await supabase.from("faq_library").delete().eq("id", faqId);

  if (error) {
    // 23503 = foreign_key_violation — the DB's ON DELETE RESTRICT backstop
    // (migration 057) catching a race where a guide started using this
    // question between the isFaqInUse() check above and this delete.
    if (error.code === "23503") {
      return {
        error: "This question is used by one or more guides and can't be deleted. Disable it instead.",
      };
    }
    console.error("[deleteFaqAction] Delete error:", error.message);
    return { error: "Failed to delete question. Please try again." };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "faq_library_deleted",
    entityType: "faq_library",
    entityId: faqId,
    entityName: (existing as { question: string } | null)?.question ?? faqId,
  });

  revalidatePath("/control-panel/content-engine/faq-library");
  return { success: true };
}
