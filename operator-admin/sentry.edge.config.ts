import * as Sentry from "@sentry/nextjs";
import { resolveSentryEnvironment, resolveSentryRelease } from "@/lib/observability/sentryRuntime";

// Edge runtime config: keep it minimal — no Node.js APIs available here.
// resolveSentryEnvironment/resolveSentryRelease are plain functions with no
// Node built-ins, safe to import here.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  enabled: process.env.NODE_ENV === "production",

  // VERCEL_ENV (not NODE_ENV) — see sentryRuntime.ts. VERCEL_ENV is
  // available in the Edge runtime the same as it is in Node.
  environment: resolveSentryEnvironment(process.env.VERCEL_ENV),

  release: resolveSentryRelease(process.env.VERCEL_GIT_COMMIT_SHA),
});
