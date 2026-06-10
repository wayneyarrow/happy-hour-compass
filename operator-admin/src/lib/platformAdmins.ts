/**
 * DB helpers for the platform_admins table.
 *
 * All functions use createAdminClient() (service-role) because platform_admins
 * is an internal-only table with no RLS policies for anon/authenticated.
 *
 * Server-only — never import from client components.
 */

import { createAdminClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlatformAdminStatus = "active" | "invited" | "revoked";

export type PlatformAdmin = {
  id:                string;
  email:             string;
  status:            PlatformAdminStatus;
  invited_by_email:  string | null;
  invite_token:      string | null;
  invite_expires_at: string | null;
  invited_at:        string | null;
  accepted_at:       string | null;
  revoked_at:        string | null;
  revoked_by_email:  string | null;
  created_at:        string;
  updated_at:        string;
};

// ── Queries ───────────────────────────────────────────────────────────────────

/** Returns all platform admin records ordered by creation date. */
export async function getPlatformAdmins(): Promise<PlatformAdmin[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[platformAdmins] getPlatformAdmins error:", error.message);
    return [];
  }
  return (data ?? []) as PlatformAdmin[];
}

/** Returns the platform_admins row for a given email, or null if not found. */
export async function getPlatformAdminByEmail(
  email: string
): Promise<PlatformAdmin | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("[platformAdmins] getPlatformAdminByEmail error:", error.message);
    return null;
  }
  return (data as PlatformAdmin | null) ?? null;
}

/**
 * Returns the platform_admins row matching an invite token.
 * Only returns rows where the token is non-null and not expired.
 */
export async function getPlatformAdminByToken(
  token: string
): Promise<PlatformAdmin | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("*")
    .eq("invite_token", token)
    .eq("status", "invited")
    .gt("invite_expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("[platformAdmins] getPlatformAdminByToken error:", error.message);
    return null;
  }
  return (data as PlatformAdmin | null) ?? null;
}

/** Returns true if there is at least one active platform admin other than the given email. */
export async function hasOtherActivePlatformAdmin(
  excludeEmail: string
): Promise<boolean> {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("platform_admins")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .neq("email", excludeEmail.trim().toLowerCase());

  if (error) {
    console.error("[platformAdmins] hasOtherActivePlatformAdmin error:", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}
