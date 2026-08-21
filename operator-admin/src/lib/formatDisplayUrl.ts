/**
 * Formats a stored website URL for display as short link text (e.g. a venue's
 * "Website" row on a public detail page). Never changes the URL itself — only
 * how it's shown; callers keep using the original stored value as the href.
 */

const FALLBACK_MAX_LENGTH = 40;

export function formatDisplayUrl(url: string): string {
  try {
    const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(normalised).hostname.replace(/^www\./i, "");
  } catch {
    // Not a parseable URL — fall back to a safely shortened version of the
    // raw string rather than crashing or rendering it in full.
    const stripped = url.replace(/^https?:\/\//i, "");
    return stripped.length > FALLBACK_MAX_LENGTH
      ? `${stripped.slice(0, FALLBACK_MAX_LENGTH)}…`
      : stripped;
  }
}
