-- =============================================================================
-- Happy Hour Compass — Operator Submissions: More Info Form Flow
-- Migration: 021_operator_submissions_more_info.sql
--
-- PURPOSE:
--   Supports the structured "Provide More Info" flow for operator submissions
--   that need founder review. When a founder clicks "Request more info", a
--   secure token is generated and emailed to the submitter. The submitter
--   opens a public HHC-hosted form via the token link and provides additional
--   verification details. The form updates this row.
--
-- NEW STATUS VALUE:
--   info_submitted — submitter completed the more-info form; awaiting founder review.
--
-- TOKEN COLUMNS:
--   more_info_token       TEXT UNIQUE — 64-char hex token (32 random bytes).
--                                       One active token per submission; overwritten
--                                       on re-request. Cleared to NULL after use.
--   more_info_expires_at  TIMESTAMPTZ — 72 hours after token generation.
--                                       Expired tokens rejected server-side.
--   more_info_completed_at TIMESTAMPTZ — set when the submitter successfully
--                                        submits the form. Used to detect reuse.
--
-- VERIFICATION DETAIL COLUMNS:
--   These are founder-review-only fields collected via the more-info form.
--   They MUST NOT be surfaced in Operator Admin or used as operational venue data.
--   Only the Founder Control Panel should display these fields.
--
--   info_phone          TEXT     — business phone number provided by submitter.
--   info_website        TEXT     — website URL or primary social profile URL.
--   info_socials        JSONB    — additional social profiles:
--                                  { instagram, facebook, tiktok } (all optional).
--   info_relationship   TEXT     — submitter's explanation of their relationship
--                                  to the business (free-text).
--   info_additional_notes TEXT   — any other notes the submitter wants to share.
--   info_preferred_contact TEXT  — how the founder should follow up
--                                  (e.g. "email", "phone", "either").
--
-- SECURITY NOTES:
--   - more_info_token is UNIQUE — prevents multiple valid tokens from coexisting.
--   - The token is cleared (NULL) after successful form submission, preventing reuse.
--   - more_info_expires_at and more_info_completed_at are both validated server-side.
--   - The token value is NEVER logged.
-- =============================================================================


-- ── 1. Expand status CHECK constraint ────────────────────────────────────────

ALTER TABLE public.operator_submissions
  DROP CONSTRAINT IF EXISTS operator_submissions_status_check;

ALTER TABLE public.operator_submissions
  ADD CONSTRAINT operator_submissions_status_check
  CHECK (status IN (
    -- Legacy manual-review values (pre-Phase 3B)
    'new',
    'approved',
    'rejected',
    'converted_to_operator',
    -- Phase 3B automated routing
    'confirmed_auto',
    'double_claim',
    'rejected_by_user',
    'no_match',
    -- Phase 3C founder review actions (migration 020)
    'needs_more_info',
    'closed',
    -- Phase 3D structured more-info form (this migration)
    'info_submitted'
  ));

COMMENT ON COLUMN public.operator_submissions.status IS
  'Routing/review status. '
  'Legacy: new, approved, rejected, converted_to_operator. '
  'Phase 3B routing: confirmed_auto, double_claim, rejected_by_user, no_match. '
  'Phase 3C founder review: needs_more_info, closed. '
  'Phase 3D more-info form: info_submitted (submitter completed structured form).';


-- ── 2. Token columns ──────────────────────────────────────────────────────────

ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS more_info_token          TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS more_info_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS more_info_completed_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.operator_submissions.more_info_token IS
  '64-char hex token (32 random bytes) used as the credential for the '
  'public more-info form URL. Unique across all submissions. '
  'Cleared to NULL after successful form submission to prevent reuse. '
  'Overwritten on re-request. Never logged.';

COMMENT ON COLUMN public.operator_submissions.more_info_expires_at IS
  'Token expiration timestamp. Set to NOW() + 72h when token is generated. '
  'NULL after token is cleared. Tokens past this timestamp are rejected.';

COMMENT ON COLUMN public.operator_submissions.more_info_completed_at IS
  'Set when the submitter successfully submits the more-info form. '
  'Used as an additional guard against token reuse alongside token clearing.';

-- Index for fast public token lookup (O(1) for the form page server-side validation).
CREATE INDEX IF NOT EXISTS operator_submissions_more_info_token_idx
  ON public.operator_submissions (more_info_token)
  WHERE more_info_token IS NOT NULL;


-- ── 3. Verification detail columns ───────────────────────────────────────────
--    Founder-review-only. Must not be surfaced in Operator Admin.

ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS info_phone              TEXT,
  ADD COLUMN IF NOT EXISTS info_website            TEXT,
  ADD COLUMN IF NOT EXISTS info_socials            JSONB,
  ADD COLUMN IF NOT EXISTS info_relationship       TEXT,
  ADD COLUMN IF NOT EXISTS info_additional_notes   TEXT,
  ADD COLUMN IF NOT EXISTS info_preferred_contact  TEXT;

COMMENT ON COLUMN public.operator_submissions.info_phone IS
  'Business phone number provided by the submitter via the more-info form. '
  'Founder-review-only — do not expose in Operator Admin.';

COMMENT ON COLUMN public.operator_submissions.info_website IS
  'Business website URL or primary social profile URL from the more-info form. '
  'Founder-review-only.';

COMMENT ON COLUMN public.operator_submissions.info_socials IS
  'JSONB map of additional social profiles from the more-info form. '
  'Shape: { "instagram": "...", "facebook": "...", "tiktok": "..." }. '
  'Keys are only present when the submitter provided a value. '
  'Founder-review-only — do not expose in Operator Admin.';

COMMENT ON COLUMN public.operator_submissions.info_relationship IS
  'Submitter''s free-text explanation of their relationship to the business '
  '(e.g. "I am the owner and have operated it since 2019"). '
  'Founder-review-only.';

COMMENT ON COLUMN public.operator_submissions.info_additional_notes IS
  'Any additional notes the submitter chose to include on the more-info form. '
  'Founder-review-only.';

COMMENT ON COLUMN public.operator_submissions.info_preferred_contact IS
  'How the founder should follow up with the submitter '
  '(e.g. "email", "phone", "either"). Founder-review-only.';
