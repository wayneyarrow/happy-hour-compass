/**
 * Deployment classification for first-party analytics rows (migration 110's
 * `environment` column on every website tracking table).
 *
 * Production and staging share one Supabase project, so every /api/track/*
 * route stamps each row with the deployment that wrote it. Server-side only —
 * a client-supplied environment is never trusted.
 *
 * Why not VERCEL_ENV alone: staging is a Vercel *Preview* deployment (the
 * `website` branch, aliased to staging.happyhourcompass.com), so VERCEL_ENV
 * is "preview" for it AND for any other branch or CLI preview. The Vercel
 * project (verified 2026-10-10 via `vercel inspect`) has:
 *   - Production (main) → happyhourcompass.com, www., kelownahappyhours.com,
 *     happy-hour-compass.vercel.app
 *   - Preview (website) → staging.happyhourcompass.com
 * VERCEL_GIT_COMMIT_REF (a Vercel system variable, set for Git-triggered
 * builds) distinguishes the `website` branch from any other preview.
 * NEXT_PUBLIC_SITE_URL can't be used: it is set for *all* Preview builds.
 *
 *   production  — VERCEL_ENV=production
 *   staging     — VERCEL_ENV=preview and VERCEL_GIT_COMMIT_REF=website
 *   preview     — any other VERCEL_ENV=preview (other branch, CLI deploy)
 *   development — not on Vercel (local `next dev`, scripts, tests) — never
 *                 "production", even though local dev writes to the shared DB
 */

export type AnalyticsEnvironment = "production" | "staging" | "preview" | "development";

export const STAGING_GIT_BRANCH = "website";

export function resolveAnalyticsEnvironment(env: NodeJS.ProcessEnv = process.env): AnalyticsEnvironment {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") {
    return env.VERCEL_GIT_COMMIT_REF === STAGING_GIT_BRANCH ? "staging" : "preview";
  }
  return "development";
}

/**
 * PostgREST `.or()` filter for rows that count toward view/click metrics:
 * legacy rows (environment NULL — written before migration 110, never
 * backfilled) and production rows. Rows explicitly labelled staging,
 * preview or development are excluded. The venue_view_counts() /
 * event_view_counts() RPCs apply the same rule in SQL (migration 111).
 */
export const COUNTED_VIEW_ENVIRONMENT_FILTER = "environment.is.null,environment.eq.production";
