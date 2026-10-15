-- =============================================================================
-- Happy Hour Compass — Migration 112: Scout report storage
-- File: supabase/migrations/112_scout_reports.sql
--
-- STATUS: not yet applied. Apply only with explicit authorization.
--
-- Private, internal-only storage for the weekly Scout "Product Usage &
-- Discovery" report (src/lib/scoutReport/). One row per report type,
-- environment and reporting period; the row holds the full versioned JSON
-- payload produced by the stage-one builder, plus generation state.
--
-- DESIGN
--   * Generation state (generating / generated / failed) is separate from
--     report completeness (complete / incomplete): a successfully generated
--     report can contain incomplete sections.
--   * Duplicate-run protection is atomic: the UNIQUE (report_type,
--     environment, period_start) constraint means only one INSERT can claim
--     a period. Re-attempts take over an existing row only through a
--     compare-and-swap UPDATE in application code (scoutReportStore.ts).
--   * Abandoned runs: lease_started_at is set while generating. A lease older
--     than the application's stale threshold may be taken over; attempts per
--     period are capped (attempt_count).
--   * Historical snapshots: once a row holds a COMPLETE payload it can never
--     be updated (trigger below) — later venue renames, milestone changes or
--     builder changes can't alter it. A complete report is never replaced
--     by a retry. Identity columns can never change.
--   * environment is part of the key so staging QA rows ('staging') can never
--     collide with, or be mistaken for, the production report.
--   * Retention target: 26 weeks. Cleanup is done by the application, scoped
--     to this table, one report_type and one environment at a time
--     (docs/analytics/SCOUT_REPORTS.md).
--
-- ACCESS
--   RLS enabled, no policies. anon and authenticated get NO privileges
--   (explicit REVOKE — this project's default privileges would otherwise
--   grant them ALL on new public tables). service_role only, used
--   server-side by the cron route and future founder-only Control Panel
--   reads (which must use requireControlPanelAdmin()). No view, no RPC and
--   no storage bucket exposes report data. Any Scout read access is a
--   separate, reviewed step.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.scout_reports (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type              TEXT        NOT NULL CHECK (report_type IN ('product_usage_and_discovery')),
  environment              TEXT        NOT NULL CHECK (environment IN ('production', 'staging')),

  -- Reporting period: half-open [period_start, period_end), Vancouver Monday midnights.
  period_start             TIMESTAMPTZ NOT NULL,
  period_end               TIMESTAMPTZ NOT NULL,
  period_start_date        DATE        NOT NULL,
  period_end_date          DATE        NOT NULL,
  time_zone                TEXT        NOT NULL,

  -- Latest attempt.
  generation_state         TEXT        NOT NULL CHECK (generation_state IN ('generating', 'generated', 'failed')),
  trigger_source           TEXT        NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')),
  attempt_count            INTEGER     NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 10),
  lease_started_at         TIMESTAMPTZ,
  last_attempt_started_at  TIMESTAMPTZ NOT NULL,
  last_attempt_finished_at TIMESTAMPTZ,
  last_attempt_outcome     TEXT        CHECK (last_attempt_outcome IN ('stored', 'kept_previous', 'failed')),
  last_failure             JSONB,
  failure_alerted_at       TIMESTAMPTZ,
  builder_version          TEXT,

  -- Stored report (null until an attempt produced one).
  payload                  JSONB,
  schema_version           TEXT,
  completeness             TEXT        CHECK (completeness IN ('complete', 'incomplete')),
  incomplete_sections      TEXT[]      NOT NULL DEFAULT '{}',
  retry_advice             TEXT,
  report_generated_at      TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT scout_reports_period_order CHECK (period_end > period_start),
  CONSTRAINT scout_reports_lease_matches_state CHECK ((generation_state = 'generating') = (lease_started_at IS NOT NULL)),
  CONSTRAINT scout_reports_payload_fields CHECK (
    (payload IS NULL AND completeness IS NULL AND schema_version IS NULL AND report_generated_at IS NULL)
    OR (payload IS NOT NULL AND completeness IS NOT NULL AND schema_version IS NOT NULL AND report_generated_at IS NOT NULL)
  ),
  CONSTRAINT scout_reports_failed_has_no_payload CHECK (generation_state <> 'failed' OR payload IS NULL),
  CONSTRAINT scout_reports_one_per_period UNIQUE (report_type, environment, period_start)
);

COMMENT ON TABLE public.scout_reports IS
  'Weekly Scout report snapshots (versioned JSON payload + generation state). Internal-only: service_role. Complete reports are immutable. Retention target 26 weeks (application cleanup).';
COMMENT ON COLUMN public.scout_reports.generation_state IS
  'Latest attempt: generating (lease held), generated (payload stored), failed (no payload). Independent of completeness.';
COMMENT ON COLUMN public.scout_reports.completeness IS
  'Completeness of the stored payload (null when none). A generated report may be incomplete.';
COMMENT ON COLUMN public.scout_reports.last_failure IS
  'Sanitized failure of the latest attempt: {part, kind, message, at}. Never contains credentials or personal data.';

-- History listing for a future founder-only page: newest period first, per type + environment.
CREATE INDEX IF NOT EXISTS scout_reports_history_idx
  ON public.scout_reports (report_type, environment, period_start DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER scout_reports_updated_at
  BEFORE UPDATE ON public.scout_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Snapshot guard: a complete report is never modified, and a row's identity never changes.
CREATE OR REPLACE FUNCTION public.scout_reports_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.completeness = 'complete' THEN
    RAISE EXCEPTION 'scout_reports: a complete report is a historical snapshot and cannot be modified (id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.report_type IS DISTINCT FROM OLD.report_type
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end THEN
    RAISE EXCEPTION 'scout_reports: report identity and period cannot change (id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scout_reports_guard
  BEFORE UPDATE ON public.scout_reports
  FOR EACH ROW EXECUTE FUNCTION public.scout_reports_guard();

-- Trigger function only; never callable through the Data API.
REVOKE EXECUTE ON FUNCTION public.scout_reports_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.scout_reports_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.scout_reports_guard() FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — internal-only, no policies.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.scout_reports ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — explicit REVOKE first (default privileges would grant anon and
-- authenticated ALL), then service_role only.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.scout_reports FROM PUBLIC;
REVOKE ALL ON public.scout_reports FROM anon;
REVOKE ALL ON public.scout_reports FROM authenticated;
REVOKE ALL ON public.scout_reports FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scout_reports TO service_role;
