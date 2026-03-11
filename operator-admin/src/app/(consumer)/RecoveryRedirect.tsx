"use client";

import { useEffect } from "react";

/**
 * RecoveryRedirect — passive client component rendered in the consumer layout.
 *
 * WHY THIS EXISTS
 * ───────────────
 * When an operator clicks the "Set up my password" email link, Supabase's
 * /auth/v1/verify endpoint is supposed to redirect to:
 *   {APP_URL}/operator/create-password#access_token=...&type=recovery
 *
 * Supabase only honours the redirectTo URL if it is listed in the project's
 * "Additional Redirect URLs" (Auth → URL Configuration in the dashboard).
 * If the URL is NOT listed, Supabase silently falls back to the project's
 * Site URL — appending the hash tokens there instead:
 *   http://localhost:3000/#access_token=...&type=recovery
 *
 * The consumer homepage (/) is a server component and never sees the hash,
 * so the tokens are lost and the operator is stranded on the homepage.
 *
 * WHAT THIS DOES
 * ──────────────
 * On mount, reads window.location.hash. If the hash contains a Supabase
 * recovery token (`type=recovery` + `access_token`), immediately replaces
 * the current URL with /operator/create-password preserving the full hash.
 * The password-setup page then detects the session via onAuthStateChange.
 *
 * This component renders nothing visible and is a no-op for every normal
 * consumer page visit.
 *
 * PERMANENT FIX (do this in the Supabase dashboard)
 * ──────────────────────────────────────────────────
 * Add these URLs to Auth → URL Configuration → Additional Redirect URLs:
 *   http://localhost:3000/operator/create-password
 *   https://<your-production-domain>/operator/create-password
 *
 * Once those are added, Supabase will redirect directly to
 * /operator/create-password and this component becomes a harmless no-op.
 */
export function RecoveryRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery") && hash.includes("access_token=")) {
      // Replace current history entry so pressing Back doesn't loop through /.
      window.location.replace("/operator/create-password" + hash);
    }
  }, []);

  return null;
}
