-- =============================================================================
-- Happy Hour Compass — Setup-Contact / Milestone Email Coordination
-- Migration: 104_setup_contact_coordination.sql
--
-- STATUS: not yet applied.
--
-- Per-operator evidence that lets the two automated senders — the
-- operator-activation reminder worker and the Customer Success milestone
-- worker — keep at least 48 hours between a setup email and an
-- incomplete-setup milestone email (src/lib/activation/setupContactPolicy.ts).
-- Coordination is per OPERATOR (not per lifecycle or venue) because an
-- operator can own several venues and have claim and submission origins.
--
-- WHAT THIS ADDS to public.operators (columns only — no new table, so no new
-- GRANT block; RLS and existing policies are unchanged):
--
--   - last_setup_contact_at / last_setup_contact_kind — the latest setup
--     email ATTEMPTED to this operator while they had not activated:
--     initial setup / code emails, automatic reminders, founder resends
--     (including Final resend), and operator-requested recovery/setup
--     emails. Recorded by sendTransactionalEmail() immediately BEFORE the
--     provider call, so a provider timeout or crash still counts
--     (conservative: an email that then definitively failed can only delay
--     a later milestone, never cause a collision).
--
--   - last_setup_pause_at — the founder's "Copy setup link" action. A
--     precautionary pause only: no email was sent by Happy Hour Compass
--     (the founder may paste the link into their own email).
--
--   - last_milestone_contact_at / last_milestone_contact_status — the latest
--     milestone email to this operator while they had not activated that the
--     provider ACCEPTED ('accepted') or MAY have accepted ('unconfirmed':
--     network error, provider 5xx/unknown error, or a worker that died
--     mid-send). A definite provider rejection records nothing, so a
--     rejected milestone never defers or skips a needed reminder. Either
--     status protects the full 48 h — the evidence lives in this column, not
--     in the short-lived claim, so it survives the claim's expiry.
--
--   - setup_contact_claimed_at / setup_contact_claim_kind — a short-lived
--     claim (lifetime in code: SETUP_CONTACT_CLAIM_TTL_MS) taken via
--     compare-and-swap by whoever is about to contact this operator: the
--     reminder or milestone worker, a founder Final resend / Resend / Copy
--     setup link (founder actions are exempt from 48 h spacing, not from
--     this claim), or an automatic initial setup email (approval, deferred
--     email-code start, legacy tracking start), which waits briefly for the
--     claim instead of being refused. A holder releases it only after its evidence is
--     safely written; otherwise the claim is left to go stale and is
--     folded into the evidence above as a possible contact of its kind
--     before anyone replaces it.
--
-- All new columns are NULL for every existing row. NULL evidence means "no
-- recorded contact" — see docs/operations/SETUP_CONTACT_COORDINATION_ROLLOUT.md
-- for the evidence-based initialization to run before the coordination flag
-- (SETUP_CONTACT_COORDINATION_ENABLED) is turned on, so existing recent
-- contacts are not ignored.
--
-- Compatible with code that predates it: nothing reads or writes these
-- columns except the coordination code, and every column is nullable.
-- Rollback: turn the flag off (the columns are then only written, never
-- acted on); dropping the columns requires removing that code first.
-- =============================================================================

ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS last_setup_contact_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_setup_contact_kind   TEXT,
  ADD COLUMN IF NOT EXISTS last_setup_pause_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_milestone_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_milestone_contact_status TEXT,
  ADD COLUMN IF NOT EXISTS setup_contact_claimed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_contact_claim_kind  TEXT;

ALTER TABLE public.operators DROP CONSTRAINT IF EXISTS operators_last_setup_contact_kind_check;
ALTER TABLE public.operators
  ADD CONSTRAINT operators_last_setup_contact_kind_check
  CHECK (
    last_setup_contact_kind IS NULL
    OR last_setup_contact_kind IN ('setup_email', 'reminder', 'founder_resend', 'founder_final_resend', 'operator_requested', 'unconfirmed_setup_contact')
  );

ALTER TABLE public.operators DROP CONSTRAINT IF EXISTS operators_setup_contact_claim_kind_check;
ALTER TABLE public.operators
  ADD CONSTRAINT operators_setup_contact_claim_kind_check
  CHECK (setup_contact_claim_kind IS NULL OR setup_contact_claim_kind IN ('reminder', 'milestone', 'founder_resend', 'founder_copy', 'initial_setup'));

ALTER TABLE public.operators DROP CONSTRAINT IF EXISTS operators_last_milestone_contact_status_check;
ALTER TABLE public.operators
  ADD CONSTRAINT operators_last_milestone_contact_status_check
  CHECK (last_milestone_contact_status IS NULL OR last_milestone_contact_status IN ('accepted', 'unconfirmed'));

COMMENT ON COLUMN public.operators.last_setup_contact_at IS
  'Latest setup email attempted to this operator before activation (recorded just before the provider call).';
COMMENT ON COLUMN public.operators.last_setup_contact_kind IS
  'Kind of the latest setup contact: setup_email, reminder, founder_resend, founder_final_resend, operator_requested, unconfirmed_setup_contact.';
COMMENT ON COLUMN public.operators.last_setup_pause_at IS
  'Latest founder "Copy setup link" (precautionary pause — not an email sent by HHC).';
COMMENT ON COLUMN public.operators.last_milestone_contact_at IS
  'Latest milestone email to this operator before activation that was accepted OR may have been accepted (see last_milestone_contact_status).';
COMMENT ON COLUMN public.operators.last_milestone_contact_status IS
  'accepted = provider confirmed; unconfirmed = provider outcome unknown (timeout/network/5xx, or a worker died mid-send). Both protect the full 48 h.';
COMMENT ON COLUMN public.operators.setup_contact_claimed_at IS
  'Short-lived claim held by an automated worker (reminder or milestone) while it sends to this operator.';
COMMENT ON COLUMN public.operators.setup_contact_claim_kind IS
  'Who holds setup_contact_claimed_at: reminder or milestone worker, a founder action (founder_resend, founder_copy), or an automatic initial setup email (initial_setup).';

-- No new GRANTs: no new table. RLS on public.operators is unchanged.
