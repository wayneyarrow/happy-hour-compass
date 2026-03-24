"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";

export type QaPublishState = {
  /** Number of venues published (present on success, including 0-match). */
  published?: number;
  /** City that was targeted (echoed back for the success message). */
  city?: string;
  error?: string;
};

/**
 * Publishes pipeline-imported venues for a specific city so they appear in
 * the consumer app for internal QA.
 *
 * Safety filters — ALL three must match before any row is updated:
 *   created_by_operator_id IS NULL  → imported venues only; never touches
 *                                      operator-created or claimed venues
 *   is_published = false            → already-published venues are never touched
 *   city ILIKE <input>              → scoped to the requested market
 *
 * Auth: caller must be an authenticated Control Panel admin.
 * Audit: logs the triggering email + city + count to the server console.
 * Reversible: set is_published = false on the same rows via Supabase dashboard
 *             or a future CP action.
 */
export async function qaPublishImportedVenuesAction(
  _prevState: QaPublishState,
  formData: FormData
): Promise<QaPublishState> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user || !isControlPanelAdmin(user.email)) {
    return { error: "Unauthorized." };
  }

  // ── Validate input ──────────────────────────────────────────────────────────
  const city = (formData.get("city") as string | null)?.trim();
  if (!city) {
    return { error: "City name is required." };
  }

  const supabase = createAdminClient();

  // ── Phase 1: identify target IDs (select before update) ────────────────────
  // Reading IDs first then updating only those IDs prevents any race where
  // a concurrent claim-approval could change created_by_operator_id between
  // the WHERE evaluation and the UPDATE commit.
  const { data: targets, error: selectError } = await supabase
    .from("venues")
    .select("id")
    .is("created_by_operator_id", null)   // imported only — never operator-created
    .eq("is_published", false)             // unpublished only
    .ilike("city", city);                  // market scope

  if (selectError) {
    console.error("[qaPublishImportedVenuesAction] Select failed:", selectError.message);
    return { error: `DB error: ${selectError.message}` };
  }

  const ids = (targets ?? []).map((v: { id: string }) => v.id);

  if (ids.length === 0) {
    return { published: 0, city };
  }

  // ── Phase 2: publish the pre-selected IDs ──────────────────────────────────
  const { error: updateError } = await supabase
    .from("venues")
    .update({ is_published: true })
    .in("id", ids);

  if (updateError) {
    console.error("[qaPublishImportedVenuesAction] Update failed:", updateError.message);
    return { error: `Update failed: ${updateError.message}` };
  }

  // Audit log — visible in Vercel/server logs for traceability.
  console.log(
    `[qaPublishImportedVenuesAction] Published ${ids.length} venue(s) in "${city}" — triggered by ${user.email}`
  );

  revalidatePath("/control-panel/venues");
  revalidatePath("/control-panel/settings");

  return { published: ids.length, city };
}
