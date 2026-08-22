/**
 * Environment + release resolution shared by every Sentry.init() call site
 * (sentry.server.config.ts, sentry.edge.config.ts, src/instrumentation-client.ts).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * All three configs previously tagged events with `process.env.NODE_ENV`,
 * which Next.js sets to "production" for every `next build` — including
 * Vercel's Preview/staging builds. That made Production and staging
 * indistinguishable in Sentry. Vercel's own `VERCEL_ENV` system variable
 * (server/edge) is exactly "production" | "preview" | "development" and
 * needs no dashboard configuration — it's already the codebase's
 * established environment signal everywhere else (see src/lib/siteUrl.ts,
 * src/lib/brevo/stagingGuard.ts, and every sendSlackAlert metadata block in
 * src/lib/email.ts, the Stripe webhook, etc.). This module brings Sentry's
 * tagging in line with that existing pattern instead of inventing a new one.
 *
 * The browser has no access to `VERCEL_ENV` (it's not NEXT_PUBLIC_-prefixed
 * by default). next.config.ts explicitly re-exposes it as
 * NEXT_PUBLIC_VERCEL_ENV / NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA via the `env`
 * key so the client bundle gets the same values at build time without
 * requiring Wayne to flip Vercel's "Automatically expose System Environment
 * Variables" project setting (that toggle's on/off state wasn't verifiable
 * from this codebase — see the audit report).
 */

/** The three environment labels Sentry events should ever be tagged with. */
export type SentryEnvironment = "production" | "preview" | "development";

const KNOWN_VERCEL_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "production",
  "preview",
  "development",
]);

/**
 * Resolves the Sentry `environment` tag from Vercel's own deployment-target
 * signal.
 *
 * `vercelEnv` should be `process.env.VERCEL_ENV` (server/edge) or
 * `process.env.NEXT_PUBLIC_VERCEL_ENV` (client) — both are `undefined`
 * outside of a Vercel build/runtime (e.g. plain local `next dev`).
 *
 * Deliberately never falls back to NODE_ENV: NODE_ENV is "production" for
 * every `next build` regardless of which Vercel environment produced it, so
 * using it as a fallback here would silently reintroduce the exact
 * Preview-vs-Production ambiguity this helper exists to fix. Anything that
 * isn't a recognized Vercel environment value — including plain local
 * development — resolves to "development", never "production".
 */
export function resolveSentryEnvironment(
  vercelEnv: string | undefined
): SentryEnvironment {
  if (vercelEnv && KNOWN_VERCEL_ENVIRONMENTS.has(vercelEnv)) {
    return vercelEnv as SentryEnvironment;
  }
  return "development";
}

/**
 * Resolves the Sentry `release` value from Vercel's deployment git-commit
 * signal.
 *
 * `gitSha` should be `process.env.VERCEL_GIT_COMMIT_SHA` (server/edge) or
 * `process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (client) — both are Vercel
 * System Environment Variables, automatically populated on every Vercel
 * build (Production and Preview alike) with no dashboard configuration
 * required. Outside of Vercel (local dev), both are undefined and this
 * returns `undefined` — Sentry.init() treats an undefined `release` as "no
 * release configured" rather than a literal "undefined" string, so local
 * events are cleanly unreleased instead of mislabeled.
 *
 * Never invents a fallback version number — an absent SHA means an absent
 * release, on purpose (see Part 3 of the observability foundation task).
 */
export function resolveSentryRelease(gitSha: string | undefined): string | undefined {
  return gitSha && gitSha.trim().length > 0 ? gitSha : undefined;
}
