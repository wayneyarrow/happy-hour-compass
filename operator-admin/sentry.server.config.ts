import * as Sentry from "@sentry/nextjs";
import { resolveSentryEnvironment, resolveSentryRelease } from "@/lib/observability/sentryRuntime";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  enabled: process.env.NODE_ENV === "production",

  // VERCEL_ENV (not NODE_ENV) — see sentryRuntime.ts for why: NODE_ENV is
  // "production" for every `next build`, including Vercel Preview/staging,
  // which made staging and production indistinguishable in Sentry.
  environment: resolveSentryEnvironment(process.env.VERCEL_ENV),

  // Vercel's own git-commit SHA, auto-populated on every Vercel build with
  // no dashboard configuration required. Undefined locally — Sentry treats
  // that as "no release" rather than a literal "undefined" string.
  release: resolveSentryRelease(process.env.VERCEL_GIT_COMMIT_SHA),
});
