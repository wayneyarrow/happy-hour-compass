import * as Sentry from "@sentry/nextjs";
import { resolveSentryEnvironment, resolveSentryRelease } from "@/lib/observability/sentryRuntime";

// Instrument client-side navigations (required for performance tracing).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// Client-side Sentry init — loaded automatically by Next.js 15+ for both
// Turbopack (dev) and webpack (production) builds.
// Replaces the legacy sentry.client.config.ts convention.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of traces in production — sufficient for performance insight
  // without inflating quota. Raise to 1.0 while debugging a specific issue.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Capture replay only on errors (no continuous recording keeps quota near zero).
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Disable in development so local noise doesn't pollute the Sentry project.
  enabled: process.env.NODE_ENV === "production",

  // The browser has no access to the server-only VERCEL_ENV /
  // VERCEL_GIT_COMMIT_SHA vars — next.config.ts's `env` block re-exposes
  // them as NEXT_PUBLIC_VERCEL_ENV / NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA at
  // build time so the client gets the same environment/release tagging as
  // the server, without requiring a Vercel dashboard change. See
  // sentryRuntime.ts for why NODE_ENV can't be used for this.
  environment: resolveSentryEnvironment(process.env.NEXT_PUBLIC_VERCEL_ENV),

  release: resolveSentryRelease(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA),
});
