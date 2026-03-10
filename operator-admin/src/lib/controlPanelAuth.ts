/**
 * Admin Control Panel access helper.
 *
 * V1 gate: email allowlist via the CONTROL_PANEL_ADMIN_EMAILS environment variable.
 * Set a comma-separated list of authorized emails in .env.local and in Vercel env vars.
 *
 * Example:
 *   CONTROL_PANEL_ADMIN_EMAILS=wayne@example.com,ops@example.com
 *
 * To evolve: replace or supplement this with an `operators.role === 'platform_admin'`
 * DB check once a formal admin role is established in the operators table.
 */
export function isControlPanelAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const raw = process.env.CONTROL_PANEL_ADMIN_EMAILS ?? "";
  if (!raw.trim()) return false;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase());
}
