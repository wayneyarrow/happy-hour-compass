import { createAdminClient } from "@/lib/supabase/server";

/**
 * Updates operators.last_seen_at for the given email, throttled to at most
 * once per hour per operator.
 *
 * The conditional filter (last_seen_at IS NULL OR last_seen_at < now - 1h)
 * makes this a fast no-op when called within the throttle window — PostgreSQL
 * matches 0 rows and performs no write I/O.
 *
 * Uses the admin client (service-role) to bypass RLS.
 *
 * Call as fire-and-forget:
 *   void updateOperatorLastSeen(email).catch(() => {});
 */
export async function updateOperatorLastSeen(email: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const threshold = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await supabase
      .from("operators")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("email", email)
      .or(`last_seen_at.is.null,last_seen_at.lt.${threshold}`);
  } catch {
    // Intentionally swallowed — activity tracking must never affect app behaviour.
  }
}
