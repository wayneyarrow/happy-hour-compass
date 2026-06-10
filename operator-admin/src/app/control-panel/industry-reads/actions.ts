"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";

/**
 * Records a founder feedback signal on an Industry Reads article.
 *
 * Defense-in-depth: CP layout already ensures only admins reach this page,
 * but the action re-validates the caller so a direct invocation can't bypass
 * the access gate.
 *
 * Uses createAdminClient (service-role) for the INSERT — RLS policies on
 * industry_reads_feedback were dropped in migration 039 since this table is
 * internal-only. The session client is still used for auth.getUser() only.
 *
 * Revalidates /control-panel/industry-reads so feedback counts refresh on
 * the next page visit without requiring a manual reload.
 */
export async function submitArticleFeedback(
  articleUrl: string,
  articleTitle: string,
  feedback: "thumbs_up" | "thumbs_down"
): Promise<void> {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user?.email || !isControlPanelAdmin(user.email)) return;

  const supabase = createAdminClient();
  await supabase.from("industry_reads_feedback").insert({
    article_url: articleUrl,
    article_title: articleTitle,
    feedback,
  });

  revalidatePath("/control-panel/industry-reads");
}
