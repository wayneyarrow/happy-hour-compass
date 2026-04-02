-- =============================================================================
-- Happy Hour Compass — Operator Submission Routing + Venue Link
-- Migration: 016_operator_submissions_phase3b.sql
--
-- PURPOSE:
--   Extends operator_submissions to support Phase 3B automated routing:
--   venue lookup by place_id, venue creation (unpublished), and trust signal
--   storage captured at submit time.
--
-- WHAT THIS MIGRATION ADDS:
--   1. Expands the status CHECK constraint to include Phase 3B routing outcome
--      values (confirmed_auto, double_claim, rejected_by_user, no_match).
--   2. Adds venue_id FK → venues(id): the venue linked during routing.
--      Set for confirmed_auto and double_claim; NULL for all other statuses.
--   3. Adds trust signal storage columns (informational only — not used for
--      routing decisions).
--
-- STATUS VALUE GUIDE (full set after this migration):
--   ── Manual review (pre-3B legacy):
--     new                   — unrouted submission; should not appear after 3B
--     approved              — manually approved
--     rejected              — manually rejected
--     converted_to_operator — operator account + venue created
--   ── Phase 3B automated routing:
--     confirmed_auto        — match confirmed; venue linked (new or existing, unclaimed)
--     double_claim          — match confirmed but venue is already claimed/owned
--     rejected_by_user      — submitter rejected the Google match
--     no_match              — no Google match found; needs manual review
--
-- DESIGN DECISIONS:
--   - match_status (the submitter's response) is NOT modified by this migration.
--     Only status (the internal routing/review outcome) gains new values.
--   - venue_id uses ON DELETE SET NULL: deleting a venue row will not
--     cascade-delete the submission. The submission history is preserved.
--   - Trust signals are nullable throughout — signals are best-effort and must
--     not block submission when IP resolution or domain comparison fails.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXPAND STATUS CHECK CONSTRAINT
--    Drop the old constraint and replace it with the full Phase 3B value set.
--    The four legacy values are preserved unchanged for backwards compatibility.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  DROP CONSTRAINT IF EXISTS operator_submissions_status_check;

ALTER TABLE public.operator_submissions
  ADD CONSTRAINT operator_submissions_status_check
  CHECK (status IN (
    'new',
    'approved',
    'rejected',
    'converted_to_operator',
    'confirmed_auto',
    'double_claim',
    'rejected_by_user',
    'no_match'
  ));

COMMENT ON COLUMN public.operator_submissions.status IS
  'Routing/review status. Legacy values: new, approved, rejected, converted_to_operator. '
  'Phase 3B values: confirmed_auto (auto-routed confirmed match, venue linked), '
  'double_claim (confirmed but venue already claimed/owned), '
  'rejected_by_user (submitter rejected Google match), '
  'no_match (no Google match found — needs manual review). '
  'Distinct from match_status, which tracks the submitter''s response to the match confirmation.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. VENUE LINK
--    FK to venues(id). Set during Phase 3B routing when a venue is found or
--    created. NULL for rejected_by_user and no_match submissions.
--    ON DELETE SET NULL: deleting a venue will not cascade-delete the submission.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.operator_submissions.venue_id IS
  'The venue linked to this submission during Phase 3B routing. '
  'Set for confirmed_auto (new or existing unclaimed venue) and double_claim '
  '(existing claimed venue). NULL for rejected_by_user and no_match submissions. '
  'FK to venues(id), ON DELETE SET NULL.';

-- Partial index — only indexes rows that have a venue_id (routing outcomes
-- confirmed_auto and double_claim). Keeps the index tiny.
CREATE INDEX IF NOT EXISTS operator_submissions_venue_id_idx
  ON public.operator_submissions (venue_id)
  WHERE venue_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRUST SIGNAL STORAGE
--    Six columns capturing submitter trust signals computed at submit time.
--    All are nullable — signals are best-effort and must not block submission.
--    IMPORTANT: these are informational only. They do NOT affect routing.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS email_domain_matches_website   BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_public_email_domain         BOOLEAN,
  ADD COLUMN IF NOT EXISTS role_trust_level               TEXT,
  ADD COLUMN IF NOT EXISTS geo_ip_country                 TEXT,
  ADD COLUMN IF NOT EXISTS geo_ip_region                  TEXT,
  ADD COLUMN IF NOT EXISTS geo_ip_matches_business_region BOOLEAN;

COMMENT ON COLUMN public.operator_submissions.email_domain_matches_website IS
  'TRUE when the submitter email domain matches the Google-matched venue website domain '
  '(exact or subdomain). NULL when comparison is not possible (public email, no website, '
  'or no Google match).';

COMMENT ON COLUMN public.operator_submissions.is_public_email_domain IS
  'TRUE when the submitter email uses a known public/free mailbox provider '
  '(e.g. gmail.com, hotmail.com). Derived from PUBLIC_EMAIL_DOMAINS in trustSignals.ts.';

COMMENT ON COLUMN public.operator_submissions.role_trust_level IS
  'Categorised trust level of the submitted position. '
  'strong = Owner or Manager; moderate = Bartender or Server; weak = anything else.';

COMMENT ON COLUMN public.operator_submissions.geo_ip_country IS
  'Country resolved from the submitter IP via ip-api.com at submit time. '
  'NULL when IP is unavailable, private/loopback, or resolution fails.';

COMMENT ON COLUMN public.operator_submissions.geo_ip_region IS
  'Region/province name resolved from the submitter IP via ip-api.com at submit time. '
  'Typically a full province/state name (e.g. "British Columbia"). '
  'NULL when IP is unavailable, private/loopback, or resolution fails.';

COMMENT ON COLUMN public.operator_submissions.geo_ip_matches_business_region IS
  'TRUE when geo_ip_region matches the Google-matched venue province (case-insensitive). '
  'NULL when either geo_ip_region or the matched venue province is unavailable.';
