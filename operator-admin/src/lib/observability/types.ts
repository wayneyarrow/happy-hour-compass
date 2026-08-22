/**
 * Shared types for the HHC production-observability foundation.
 *
 * See src/lib/observability/reportOperationalError.ts for the reusable
 * handled-error reporter this severity model feeds into, and
 * docs/... (architecture audit) for the reasoning behind the three tiers.
 */

/**
 * Operational severity for a handled (caught, non-crashing) internal error.
 *
 * This is intentionally separate from Sentry's own `level` (fatal/error/
 * warning/...) — it's HHC's own triage tier, attached to every captured
 * event as a `severity` tag so Sentry issues (and, in a later task, Slack
 * routing) can be filtered/grouped by it without relying on Sentry's level
 * alone.
 *
 *   warning     — degraded but recoverable; not customer-blocking on its own.
 *   operational — an internal failure that blocked a customer action, but
 *                 isn't (yet) judged acquisition/revenue-critical.
 *   critical    — blocks a customer/business-critical journey (acquisition,
 *                 activation, payments). Reserved for what should eventually
 *                 page #ops-critical — see reportOperationalError's doc
 *                 comment for why that routing isn't wired up yet.
 */
export type OperationalSeverity = "warning" | "operational" | "critical";
