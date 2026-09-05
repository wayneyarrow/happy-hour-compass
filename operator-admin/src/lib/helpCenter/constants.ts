/**
 * Sentinel article_slug identifying a view of the Help Center landing page
 * itself (/admin/help) in help_center_view_events, as opposed to a real
 * How-To article. Chosen so it can never collide with a real article slug —
 * every real slug in articles.ts is a plain kebab-case identifier; none use
 * leading/trailing underscores.
 *
 * Kept in its own plain (non "use server") module so it can be imported from
 * both a Server Action file (trackHelpCenterView.ts, which — per Next.js's
 * "use server" rule — may only export async functions, not constants) and
 * an ordinary Server Component (the Help Center landing page).
 */
export const HELP_CENTER_INDEX_SLUG = "__index__";
