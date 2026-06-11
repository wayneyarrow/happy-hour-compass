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
