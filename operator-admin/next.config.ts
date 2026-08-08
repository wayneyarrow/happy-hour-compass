import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // Phase 1B (Lighthouse audit follow-up): the seeded venue placeholder
  // library under /images/venues/ is committed to git and only ever changes
  // via a new deploy — there is no runtime "replace this image" affordance
  // for it the way there is for operator-uploaded Supabase Storage photos.
  // That makes it safe to cache immutably. Scoped narrowly to this one path
  // rather than /images/:path* or sitewide, so it doesn't touch caching for
  // any other static asset (see docs/website — Lighthouse audit + Phase 1B
  // investigation for the full reasoning).
  async headers() {
    return [
      {
        source: "/images/venues/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry org/project — required for source map upload.
  // These values are read at build time from env vars (set in Vercel).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Source map upload requires SENTRY_AUTH_TOKEN.
  // On Vercel Hobby the token is optional — Sentry still captures errors,
  // stack traces will show minified code until a token is added.
  // authToken is automatically read from the SENTRY_AUTH_TOKEN env var.

  // Suppress noisy build output locally; keep verbose on CI.
  silent: !process.env.CI,

  // Opt out of Sentry's anonymous build telemetry.
  telemetry: false,
});
