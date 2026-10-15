/**
 * Server-side kill switch for scheduled Scout report generation (stage two).
 *
 * Default (unset, empty, or anything other than exactly "true"): DISABLED —
 * the cron route returns before reading or writing anything. Set it per
 * environment in Vercel only after migration 112 is applied and QA is
 * reviewed. Never logs or exposes the value. Server-only.
 */
export function isScoutReportGenerationEnabled(): boolean {
  return process.env.SCOUT_REPORT_GENERATION_ENABLED === "true";
}
