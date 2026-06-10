/**
 * Admin Control Panel access helper.
 *
 * Access is granted if EITHER condition is true:
 *   1. DB check: a platform_admins row with status='active' exists for the email.
 *   2. Env-var fallback: email is in CONTROL_PANEL_ADMIN_EMAILS (comma/newline separated).
 *
 * The env-var fallback is intentionally retained as an emergency escape hatch.
 * It allows founder access even if the DB is unavailable or the seed failed.
 *
 * DB check is performed first; env-var is only consulted if the DB check returns
 * false (or the platform_admins table doesn't exist yet during migration).
 *
 * VERCEL SETUP — IMPORTANT:
 *   Ensure CONTROL_PANEL_ADMIN_EMAILS is enabled for ALL three environments:
 *     ✓ Production  ✓ Preview  ✓ Development
 *   If set only for "Preview", process.env will be undefined in production.
 */

import { getPlatformAdminByEmail } from "@/lib/platformAdmins";

// ── Env-var fallback (synchronous) ────────────────────────────────────────────

function isEnvVarAdmin(email: string): boolean {
  const raw = process.env.CONTROL_PANEL_ADMIN_EMAILS ?? "";
  if (!raw.trim()) return false;

  const allowlist = raw
    .split(/[,\n]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.trim().toLowerCase());
}

// ── Primary check (DB-backed + env-var fallback) ──────────────────────────────

/**
 * Returns true if the email is an active platform admin.
 *
 * Checks the platform_admins DB table first; falls back to the
 * CONTROL_PANEL_ADMIN_EMAILS env var if no active DB record is found.
 */
export async function isControlPanelAdmin(
  email: string | undefined
): Promise<boolean> {
  if (!email) return false;

  const normalised = email.trim().toLowerCase();

  // ── 1. DB check ─────────────────────────────────────────────────────────────
  try {
    const admin = await getPlatformAdminByEmail(normalised);
    if (admin?.status === "active") return true;
  } catch (err) {
    // DB unavailable (e.g. pre-migration local dev) — fall through to env var.
    console.warn(
      "[ControlPanel] DB admin check failed — falling back to env-var allowlist.",
      err instanceof Error ? err.message : err
    );
  }

  // ── 2. Env-var fallback ──────────────────────────────────────────────────────
  const envGranted = isEnvVarAdmin(normalised);

  if (!envGranted) {
    console.error(
      `[ControlPanel] Access denied for ${normalised} — not in DB or env-var allowlist.`
    );
  }

  return envGranted;
}
