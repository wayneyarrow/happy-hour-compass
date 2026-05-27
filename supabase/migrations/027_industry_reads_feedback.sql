-- =============================================================================
-- Migration: 027_industry_reads_feedback.sql
--
-- Lightweight founder-review table for Industry Reads article quality signals.
-- Allows Wayne to thumbs-up/down individual articles to inform future keyword
-- weighting and source quality tuning — no ML, no automation, just a signal log.
--
-- Access model:
--   INSERT  → any authenticated user (UI enforces founder-only via isControlPanelAdmin)
--   SELECT  → any authenticated user (query via Supabase dashboard to review feedback)
--   DELETE  → not needed; log-style append-only
-- =============================================================================

CREATE TABLE IF NOT EXISTS industry_reads_feedback (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_url  TEXT        NOT NULL,
  article_title TEXT       NOT NULL,
  feedback     TEXT        NOT NULL CHECK (feedback IN ('thumbs_up', 'thumbs_down')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE industry_reads_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_insert_feedback"
  ON industry_reads_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_select_feedback"
  ON industry_reads_feedback
  FOR SELECT
  TO authenticated
  USING (true);
