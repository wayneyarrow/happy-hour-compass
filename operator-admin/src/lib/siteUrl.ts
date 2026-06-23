/**
 * Canonical site URL helpers — server-side safe.
 *
 * Single source of truth for the base URL used by:
 *   - metadata generation (metadataBase, canonical, OG URLs)
 *   - sitemap generation
 *   - robots.txt logic
 *   - future JSON-LD structured data
 *
 * Priority order (first match wins):
 *   1. NEXT_PUBLIC_SITE_URL   — explicit override; set this in Vercel env settings
 *   2. VERCEL_ENV=production  — Vercel production deployment without explicit override
 *   3. VERCEL_URL             — deployment-specific URL (preview builds, existing Vercel app)
 *   4. localhost:3000         — local dev fallback
 *
 * Expected values per environment:
 *   Local dev:               http://localhost:3000
 *   Existing Vercel app:     https://happy-hour-compass.vercel.app  ← via VERCEL_URL
 *   Staging:                 https://staging.happyhourcompass.com   ← via NEXT_PUBLIC_SITE_URL
 *   Production:              https://happyhourcompass.com           ← via NEXT_PUBLIC_SITE_URL or VERCEL_ENV=production
 *
 * NOTE: APP_URL (used by email.ts and Stripe redirects) remains separate.
 * It may point to the operator-admin URL, whereas NEXT_PUBLIC_SITE_URL always
 * points to the public-facing website URL.
 */

/** Returns the canonical base URL for the current environment, no trailing slash. */
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_ENV === "production") {
    return "https://happyhourcompass.com";
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

/**
 * Returns true when search engines must be blocked from indexing.
 *
 * Conditions:
 *   - NEXT_PUBLIC_NOINDEX=true is set (explicit staging / preview flag)
 *   - VERCEL_ENV=preview and no explicit site URL override (unattended preview builds)
 *
 * Set NEXT_PUBLIC_NOINDEX=true in Vercel environment settings for staging.
 * Never set it on the production environment.
 */
export function shouldNoIndex(): boolean {
  if (process.env.NEXT_PUBLIC_NOINDEX === "true") return true;
  if (!process.env.NEXT_PUBLIC_SITE_URL && process.env.VERCEL_ENV === "preview") return true;
  return false;
}

/** Returns an absolute URL by joining the canonical site URL with a path. */
export function absoluteUrl(path: string): string {
  const base = getSiteUrl();
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}
