"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";

/**
 * Records a founder feedback signal on an Industry Reads article.
 *
 * Defense-in-depth: CP layout already ensures only admins reach this page,
 * but the action re-validates the caller so a direct invocation can't bypass
 * the access gate.
 *
 * Revalidates /control-panel/industry-reads so feedback counts refresh on
 * the next page visit without requiring a manual reload.
 */
export async function submitArticleFeedback(
  articleUrl: string,
  articleTitle: string,
  feedback: "thumbs_up" | "thumbs_down"
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isControlPanelAdmin(user.email)) return;

  await supabase.from("industry_reads_feedback").insert({
    article_url: articleUrl,
    article_title: articleTitle,
    feedback,
  });

  revalidatePath("/control-panel/industry-reads");
}
