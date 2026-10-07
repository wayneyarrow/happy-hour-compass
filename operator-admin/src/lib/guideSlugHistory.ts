/**
 * Pure helpers for guide URL history (content_guide_slug_history, migration
 * 108). No I/O — the history itself is maintained atomically by the
 * content_guides_slug_history trigger; these helpers only decide redirects,
 * canonical reconciliation and user-facing error text.
 */

/** The guide's public path — /{market-slug}/guides/{guide-slug}. */
export function buildGuidePublicPath(marketSlug: string, slug: string): string {
  return `/${marketSlug}/guides/${slug}`;
}

export type HistoricalGuideTarget = {
  marketSlug: string;
  slug: string;
  /** published and inside its publish window (isGuidePublicNow). */
  isPublic: boolean;
};

/**
 * Where a retired guide URL should permanently redirect, or null for 404:
 * no history match, the guide isn't public (never redirect to a draft), or
 * the target equals the requested path (loop guard). The target is always
 * the guide's CURRENT path, read live — never a chain of old slugs.
 */
export function resolveHistoricalGuideRedirect(
  requestedPath: string,
  target: HistoricalGuideTarget | null
): string | null {
  if (!target || !target.isPublic) return null;
  const path = buildGuidePublicPath(target.marketSlug, target.slug);
  return path === requestedPath ? null : path;
}

function normalizePath(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

/**
 * canonical_url to save when a guide's URL may have changed. The editor
 * treats an existing guide's canonical as manually set, so a slug/market
 * change would otherwise leave it pointing at the old (now redirecting) URL.
 *   - URL unchanged                       → keep the submitted value.
 *   - empty                                → null (page falls back to the
 *                                            generated current path).
 *   - equals the OLD self-canonical path   → the NEW self-canonical path.
 *   - anything else (genuine override)     → preserved untouched.
 */
export function reconcileGuideCanonicalUrl(params: {
  submitted: string | null;
  previous: { marketSlug: string; slug: string };
  next: { marketSlug: string; slug: string };
}): string | null {
  const { submitted, previous, next } = params;
  const previousPath = buildGuidePublicPath(previous.marketSlug, previous.slug);
  const nextPath = buildGuidePublicPath(next.marketSlug, next.slug);
  if (previousPath === nextPath) return submitted;

  const trimmed = submitted?.trim() ?? "";
  if (!trimmed) return null;
  return normalizePath(trimmed) === previousPath ? nextPath : submitted;
}

export type GuideSlugWriteError =
  | { kind: "field"; message: string }
  | { kind: "form"; message: string };

/**
 * Maps a content_guides insert/update error to user-facing text. 23505 comes
 * from either the (market_id, slug) unique constraint or the slug-history
 * trigger (which raises 23505 with a distinctive message). Null = not a slug
 * conflict; caller uses its generic error.
 */
export function describeGuideSlugWriteError(
  error: { code?: string | null; message?: string | null } | null | undefined
): GuideSlugWriteError | null {
  if (!error || error.code !== "23505") return null;
  const message = error.message ?? "";
  if (message.includes("retired URL of another guide")) {
    return {
      kind: "field",
      message:
        "This slug is a former URL of another guide in this market (it redirects there). Choose a different slug.",
    };
  }
  if (message.includes("already recorded for a different guide")) {
    return {
      kind: "form",
      message:
        "This guide's current URL is recorded as a former URL of a different guide, so its slug can't be changed safely. Nothing was saved — please report this.",
    };
  }
  return { kind: "field", message: "This slug is already used by another guide in this market." };
}
