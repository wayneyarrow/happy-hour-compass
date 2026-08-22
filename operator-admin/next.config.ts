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
  // Re-expose two Vercel System Environment Variables to the client bundle
  // under NEXT_PUBLIC_ names. VERCEL_ENV / VERCEL_GIT_COMMIT_SHA are always
  // available server-side on Vercel with no configuration, but the browser
  // can't read them directly. This makes src/instrumentation-client.ts's
  // Sentry environment/release tagging match the server exactly, without
  // depending on Vercel's separate "Automatically expose System
  // Environment Variables" project toggle (state unknown/unverified — see
  // the observability foundation report). Falls back to "" locally (plain
  // `next dev`, no Vercel), which sentryRuntime.ts's resolvers treat as
  // "development" / "no release" respectively — never as "production".
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? "",
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
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
  // Currently UNSET in Vercel (Production or Preview) — see the
  // observability foundation report's manual setup checklist. Until set,
  // this plugin has nothing to authenticate/associate against, so it
  // no-ops on the source-map-upload step rather than failing the build
  // (see the `authToken` note below) — that's existing, intentional
  // behavior, not something this change alters.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Source map upload requires SENTRY_AUTH_TOKEN.
  // On Vercel Hobby the token is optional — Sentry still captures errors,
  // stack traces will show minified code until a token is added.
  // authToken is automatically read from the SENTRY_AUTH_TOKEN env var.

  // Names the build's Sentry release after Vercel's own git-commit SHA —
  // the same value sentryRuntime.ts's resolveSentryRelease() sets as the
  // runtime `release` in Sentry.init(). Keeping both in lockstep is what
  // lets uploaded source maps actually associate with the release a
  // captured event reports, once SENTRY_AUTH_TOKEN is configured. Safe to
  // leave in place even without a token: with no VERCEL_GIT_COMMIT_SHA
  // (local build), `name` is undefined and the plugin falls back to its
  // own default release-naming behavior.
  release: {
    name: process.env.VERCEL_GIT_COMMIT_SHA,
  },

  // Suppress noisy build output locally; keep verbose on CI.
  silent: !process.env.CI,

  // Opt out of Sentry's anonymous build telemetry.
  telemetry: false,
});
