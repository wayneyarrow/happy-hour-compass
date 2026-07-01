"use server";

import { createClient } from "@/lib/supabase/server";

export async function touchConsumerProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("consumer_profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);
}
