-- =============================================================================
-- Migration: 029_operators_plan.sql
--
-- Adds a plan column to the operators table to power tier-based feature gating,
-- analytics visibility, and future monetization flows.
--
-- Valid plan values: 'free' | 'pro' | 'premium' | 'enterprise'
--
-- Design decisions:
--   - Stored as TEXT with a CHECK constraint rather than a Postgres ENUM.
--     Reason: adding a new tier to a TEXT+CHECK is a single-statement migration;
--     adding a value to a Postgres ENUM requires ALTER TYPE, which is not
--     transactional on all versions and may lock the table.
--   - Column lives on operators (not a separate subscriptions table) because
--     there is no billing system yet. A subscriptions table can be added later
--     and this column can become a derived/cached field.
--   - All existing operators are backfilled to 'free' via the DEFAULT.
--
-- Application layer:
--   src/lib/plans.ts is the single source of truth for what each plan can access.
--   The DB constraint is a safety net, not the primary enforcer.
-- =============================================================================

-- ── Add column ────────────────────────────────────────────────────────────────

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- ── Check constraint (idempotent via DO block) ────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operators_plan_check'
  ) THEN
    ALTER TABLE operators
      ADD CONSTRAINT operators_plan_check
      CHECK (plan IN ('free', 'pro', 'premium', 'enterprise'));
  END IF;
END;
$$;
