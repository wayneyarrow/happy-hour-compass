/**
 * Admin Control Panel access helper.
 *
 * V1 gate: email allowlist via the CONTROL_PANEL_ADMIN_EMAILS environment variable.
 * Set a comma-separated list of authorized emails in .env.local and in Vercel env vars.
 *
 * Example:
 *   CONTROL_PANEL_ADMIN_EMAILS=wayne@example.com,ops@example.com
 *
 * VERCEL SETUP — IMPORTANT:
 *   In the Vercel dashboard (Project → Settings → Environment Variables) make sure
 *   CONTROL_PANEL_ADMIN_EMAILS is enabled for ALL three environments:
 *     ✓ Production
 *     ✓ Preview
 *     ✓ Development
 *   If it is only set for "Preview", process.env will be undefined in production
 *   and every admin check will silently fail with a redirect to /.
 *
 * To evolve: replace or supplement this with an `operators.role === 'platform_admin'`
 * DB check once a formal admin role is established in the operators table.
 */
export function isControlPanelAdmin(email: string | undefined): boolean {
  if (!email) return false;

  const raw = process.env.CONTROL_PANEL_ADMIN_EMAILS ?? "";

  if (!raw.trim()) {
    console.error(
      "[ControlPanel] CONTROL_PANEL_ADMIN_EMAILS is empty or not set. " +
        "Ensure it is configured for the Production environment in Vercel."
    );
    return false;
  }

  // Support both comma and newline as separators — newlines can appear when
  // env var values are copy-pasted in the Vercel dashboard.
  const allowlist = raw
    .split(/[,\n]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const normalised = email.trim().toLowerCase();
  const granted = allowlist.includes(normalised);

  if (!granted) {
    // Log the failure without exposing the full allowlist in production logs.
    console.error(
      `[ControlPanel] Access denied — email not in allowlist. ` +
        `allowlist length: ${allowlist.length}, env var is set: ${allowlist.length > 0}`
    );
  }

  return granted;
}
