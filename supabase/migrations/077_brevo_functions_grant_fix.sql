-- =============================================================================
-- Happy Hour Compass — Brevo Outbox Functions: Grant Fix
-- Migration: 077_brevo_functions_grant_fix.sql
--
-- FIX: Revoke EXECUTE on enqueue_brevo_contact_sync() and
-- claim_brevo_outbox_batch() from anon and authenticated.
--
-- WHY: 075_brevo_sync_outbox.sql revoked EXECUTE from PUBLIC only. As
-- 039_security_hardening.sql's fix 2 already documented for
-- create_owner_membership_on_operator_insert(), Supabase separately grants
-- EXECUTE on new functions to anon/authenticated directly (not merely via
-- PUBLIC) — REVOKE ... FROM PUBLIC alone does not remove that. Live
-- verification against the shared HHC Supabase project after applying 075
-- confirmed both functions still had EXECUTE granted to anon and
-- authenticated.
--
-- Both functions are SECURITY DEFINER and bypass RLS on brevo_sync_outbox —
-- an un-revoked grant would let any caller holding only the public anon key
-- enqueue arbitrary rows, or (via claim_brevo_outbox_batch) read/claim
-- in-flight payloads directly through the Data API RPC endpoint, entirely
-- outside the server-only createAdminClient() path this table is designed
-- to be reachable through exclusively.
--
-- This migration only tightens an already-additive, already internal-only
-- table's access — it does not touch any existing application table, data,
-- or unrelated object.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.enqueue_brevo_contact_sync(TEXT, UUID, TEXT, TEXT, JSONB, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_brevo_contact_sync(TEXT, UUID, TEXT, TEXT, JSONB, INTEGER) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.claim_brevo_outbox_batch(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_brevo_outbox_batch(INTEGER) FROM authenticated;
