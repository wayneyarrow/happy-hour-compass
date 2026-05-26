-- =============================================================================
-- Migration: 026_operator_homepage_v2_intro.sql
--
-- Adds homepage_v2_intro_seen_at to the operators table so the one-time
-- "Your venue is now customer-ready" V2 intro banner is tracked at the
-- operator level rather than in browser localStorage.
--
-- NULL  → operator has not yet seen the V2 intro banner
-- set   → timestamp when the operator first dismissed the banner
-- =============================================================================

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS homepage_v2_intro_seen_at TIMESTAMPTZ;
