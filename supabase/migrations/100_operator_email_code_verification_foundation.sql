-- =============================================================================
-- Happy Hour Compass — Operator Email-Code Activation (Schema Foundation)
-- Migration: 100_operator_email_code_verification_foundation.sql
--
-- STATUS: not yet applied. Email-code activation initiative, Phase 1B
-- (foundation only). Not to be confused with the earlier, already-shipped
-- "Phase 1B" Control Panel activation visibility work (see CLAUDE.md).
-- Rewritten in place during design review (atomic issuance, strict rate
-- limiting, incorrect-only attempt counting), per repository convention for
-- an unapplied file.
--
-- CONTEXT — Model A (approved):
--   Approval → provision operator/auth identity AND activation lifecycle →
--   verify email with a six-digit code → create password → activate/sign in
--   → existing Operator Dashboard homepage.
--   The lifecycle begins at approval (exactly as it does today), so the
--   existing 14-day window and the live reminder worker
--   (processActivationReminders.ts) can recover an operator who abandons
--   before code verification, after verification but before password
--   creation, or at any later point before activation. Nothing about
--   lifecycle timing, reminders, or activation (operators.account_activated_at
--   remains the ONE activation signal) changes in this migration.
--
-- ─── 1. Lifecycle fields (legacy by default) ────────────────────────────────
--   verification_required BOOLEAN NOT NULL DEFAULT false,
--   verification_completed_at TIMESTAMPTZ NULL.
--   Every existing lifecycle receives false/NULL = the legacy setup-link
--   flow it is already on. No row is opted in, no backfill, and no existing
--   operational column (started_at, deadline_at, reminder_*, expired_at,
--   released_at, expiry_*) is touched. The existing lifecycle INSERT
--   (claimOrReuseActivationLifecycle(), activationLifecycle.ts) names its
--   columns explicitly, so new lifecycles also stay legacy until a later,
--   separately authorized, feature-flagged approval path sets
--   verification_required = true at creation.
--   CHECK: verification_completed_at may only be set when
--   verification_required = true — legacy lifecycles verify email ownership
--   implicitly through the setup link, and nothing records that here.
--
-- ─── 2. operator_verification_codes ─────────────────────────────────────────
--   One row per issued code. Stores only code_digest: lowercase-hex
--   HMAC-SHA256 (exactly 64 chars — Node's createHmac("sha256").digest("hex")
--   output) of "hhc-operator-email-code:v1:<lifecycle id>:<six-digit code>",
--   keyed by OPERATOR_VERIFICATION_CODE_HMAC_SECRET (not yet set anywhere).
--   Bound to the lifecycle id, so a digest can't be replayed against another
--   lifecycle; no timestamps are included. The digest CHECK makes storing a
--   plaintext six-digit code impossible. No passwords, tokens, or links.
--
--   attempt_count = INCORRECT attempts only. A correct code never
--   increments it. A code accepts a submission (correct or incorrect) only
--   while attempt_count < max_attempts (5); the fifth incorrect attempt
--   exhausts it, after which even the correct code is rejected and a resend
--   is required.
--
-- ─── 3. Atomic database operations (the ONLY write path) ────────────────────
--   Three SECURITY DEFINER functions. service_role has SELECT-only on
--   operator_verification_codes, so trusted server code cannot insert,
--   supersede, consume, or count attempts except through these functions.
--
--   SERIALIZATION: every function first takes a row lock on the target
--   lifecycle (SELECT ... FOR UPDATE on operator_activation_lifecycles).
--   Issuance, failure recording, and consumption for one lifecycle therefore
--   run strictly one at a time, each in its own transaction, always locking
--   lifecycle-then-code (one lock order → no deadlock). Every check is made
--   AFTER the lock is held, against the latest committed state (READ
--   COMMITTED takes a fresh snapshot per statement), with v_now =
--   clock_timestamp() read after the lock so a waiter never uses a stale
--   time. The lock is held for a few milliseconds; the reminder worker's own
--   updates to the same lifecycle row simply wait that long.
--
--   issue_operator_verification_code(lifecycle, digest, ip)
--     Eligibility (after the lock): lifecycle exists; not released; not
--     expired; deadline_at still in the future (mirrors the legacy resend
--     rule — the founder must extend first); operator not activated;
--     verification_required = true; verification_completed_at IS NULL.
--     Cooldown: rejected while now < last issued_at + 60 seconds (exactly 60
--     seconds later is allowed). Rolling window: counts issued_at > now - 60
--     minutes (a send exactly 60 minutes old is outside); five in the window
--     block the next. Then supersedes the current code and inserts the new
--     one — same transaction, so a crash can never leave the old code
--     superseded with no replacement. A concurrent second request waits for
--     the lock, then sees the first request's committed code and gets
--     'cooldown' — it never receives 'issued', so it must never send an
--     email. Returns only outcome, code_id, code_expires_at,
--     resend_available_at — never the digest or IP.
--
--   Correct-code path (server code):
--     1. Load the current code (consumed_at IS NULL AND superseded_at IS
--        NULL — unique per lifecycle); if attempt_count >= max_attempts or
--        expired, respond without comparing.
--     2. Compare the HMAC in constant time (verifyVerificationCodeDigest()).
--     3. On match: consume_operator_verification_code(lifecycle, code_id) —
--        re-checks everything under the lock, sets consumed_at, and sets
--        verification_completed_at exactly once. attempt_count untouched.
--   Incorrect-code path:
--     3'. On mismatch: record_operator_verification_code_failure(lifecycle,
--        code_id) — increments attempt_count by exactly one under the lock
--        (no lost increments), only for a current, unexpired, unexhausted
--        code of an eligible lifecycle. Consumed, superseded, or expired
--        codes never gain attempts. If the call fails, server code must
--        return a generic error — never "incorrect" for an unrecorded guess.
--
--   Correct racing incorrect (deterministic): whichever call takes the
--   lifecycle lock first wins. Incorrect first → attempt_count + 1; the
--   correct consume then succeeds only if attempt_count is still <
--   max_attempts (so a correct code racing a fifth incorrect attempt that
--   committed first is rejected as 'code_exhausted'). Correct first →
--   consumed and verified; the incorrect call then sees 'already_verified'
--   and increments nothing. Two correct calls: the second sees
--   'already_verified' — a code can never be consumed twice.
--
--   ONE CONSUMED CODE PER LIFECYCLE (partial unique index): email ownership
--   is verified once per lifecycle; issuance is refused once
--   verification_completed_at is set; a lifecycle can't be verified twice.
--   A future mistyped-email recovery would start a new lifecycle rather than
--   re-verify this one, so this constraint creates no recovery problem.
--
-- ─── 4. Access ──────────────────────────────────────────────────────────────
--   Table: RLS enabled, no policy; REVOKE ALL from PUBLIC/anon/authenticated
--   (this project's default privileges would otherwise grant them full
--   table access); service_role SELECT only.
--   Functions: REVOKE EXECUTE from PUBLIC/anon/authenticated, GRANT EXECUTE
--   to service_role only (this project's default privileges grant EXECUTE
--   to anon/authenticated on new functions — see migrations 082/085/097).
--   SET search_path = '' with every object schema-qualified (stricter than
--   the older `SET search_path = public` convention: nothing a caller could
--   place on a search path can shadow an object these functions use).
--
-- NOT IMPLEMENTED HERE: per-IP and per-email cross-lifecycle abuse limits
--   (policy not yet defined). request_ip is recorded for that later phase;
--   no IP index is created until its query exists.
--
-- SCOPE: schema + functions only. No INSERT/UPDATE/DELETE of existing data,
--   no backfill, no trigger. Applying it changes no existing row's behavior.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Lifecycle verification fields (legacy by default)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_activation_lifecycles
  ADD COLUMN IF NOT EXISTS verification_required     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.operator_activation_lifecycles.verification_required IS
  'true = this lifecycle uses the email-code activation flow (verify a '
  'six-digit code before creating a password). false (the default, and '
  'the value for every lifecycle created before this migration) = the '
  'legacy setup-link flow. Only a later, feature-flagged approval path may '
  'set this to true, and only when the lifecycle is created.';
COMMENT ON COLUMN public.operator_activation_lifecycles.verification_completed_at IS
  'When the operator verified their email with a six-digit code. NULL for '
  'every legacy lifecycle (enforced by the verification-shape CHECK). Set '
  'exactly once, by consume_operator_verification_code(). Verification is '
  'NOT activation — operators.account_activated_at remains the one '
  'activation signal.';

-- DROP + re-ADD, matching the rerun-safety precedent (migrations 098/099).
ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_verification_shape_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_verification_shape_check
  CHECK (verification_completed_at IS NULL OR verification_required);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Verification-code table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_verification_codes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lifecycle_id   UUID        NOT NULL REFERENCES public.operator_activation_lifecycles(id),
  code_digest    TEXT        NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  attempt_count  INTEGER     NOT NULL DEFAULT 0,
  max_attempts   INTEGER     NOT NULL DEFAULT 5,
  consumed_at    TIMESTAMPTZ,
  superseded_at  TIMESTAMPTZ,
  request_ip     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operator_verification_codes IS
  'Six-digit email verification codes for the email-code operator '
  'activation flow (Model A). Stores only an HMAC digest, never the '
  'plaintext code. At most one CURRENT code (consumed_at IS NULL AND '
  'superseded_at IS NULL) per lifecycle. Written ONLY through '
  'issue_operator_verification_code(), '
  'record_operator_verification_code_failure(), and '
  'consume_operator_verification_code(); service_role may only SELECT. '
  'See migration 100''s header.';
COMMENT ON COLUMN public.operator_verification_codes.lifecycle_id IS
  'The activation lifecycle this code belongs to. The digest is bound to '
  'this id, so a code can never verify a different lifecycle.';
COMMENT ON COLUMN public.operator_verification_codes.code_digest IS
  'Lowercase hex HMAC-SHA256 of the code, keyed by '
  'OPERATOR_VERIFICATION_CODE_HMAC_SECRET and bound to lifecycle_id — see '
  'src/lib/activation/emailCodeVerificationPolicy.ts. NEVER the plaintext '
  'code; the shape CHECK rejects anything that is not 64 hex characters.';
COMMENT ON COLUMN public.operator_verification_codes.issued_at IS
  'When this code was issued (database clock). Drives the 60-second resend '
  'cooldown and the 5-per-rolling-60-minutes cap, both enforced inside '
  'issue_operator_verification_code(). Counted whether or not the email '
  'provider later reported delivery.';
COMMENT ON COLUMN public.operator_verification_codes.expires_at IS
  'issued_at + 10 minutes. Expired once now >= expires_at.';
COMMENT ON COLUMN public.operator_verification_codes.attempt_count IS
  'INCORRECT attempts only — a correct code never increments it. '
  'Incremented by exactly one per recorded incorrect attempt, under the '
  'lifecycle lock. At max_attempts the code is exhausted and even the '
  'correct code is rejected.';
COMMENT ON COLUMN public.operator_verification_codes.max_attempts IS
  'Incorrect-attempt budget for this code (5). Stored per row so a future '
  'policy change never retroactively alters an in-flight code.';
COMMENT ON COLUMN public.operator_verification_codes.consumed_at IS
  'When this code was successfully verified. At most one consumed code per '
  'lifecycle, ever.';
COMMENT ON COLUMN public.operator_verification_codes.superseded_at IS
  'When a newer code was issued for the same lifecycle, invalidating this '
  'one. A superseded code can never verify or gain attempts.';
COMMENT ON COLUMN public.operator_verification_codes.request_ip IS
  'Requester IP at issuance, recorded for a later abuse-control phase (no '
  'per-IP limit is enforced yet). Plain TEXT, matching '
  'venue_claims.ip_address / operator_submissions.ip_address. Never exposed '
  'to any client.';

ALTER TABLE public.operator_verification_codes
  DROP CONSTRAINT IF EXISTS operator_verification_codes_code_digest_check;
ALTER TABLE public.operator_verification_codes
  ADD CONSTRAINT operator_verification_codes_code_digest_check
  CHECK (code_digest ~ '^[0-9a-f]{64}$');

ALTER TABLE public.operator_verification_codes
  DROP CONSTRAINT IF EXISTS operator_verification_codes_expiry_check;
ALTER TABLE public.operator_verification_codes
  ADD CONSTRAINT operator_verification_codes_expiry_check
  CHECK (expires_at > issued_at);

ALTER TABLE public.operator_verification_codes
  DROP CONSTRAINT IF EXISTS operator_verification_codes_attempts_check;
ALTER TABLE public.operator_verification_codes
  ADD CONSTRAINT operator_verification_codes_attempts_check
  CHECK (max_attempts > 0 AND attempt_count >= 0 AND attempt_count <= max_attempts);

-- A code is either consumed or superseded (or neither, while current) —
-- never both.
ALTER TABLE public.operator_verification_codes
  DROP CONSTRAINT IF EXISTS operator_verification_codes_terminal_state_check;
ALTER TABLE public.operator_verification_codes
  ADD CONSTRAINT operator_verification_codes_terminal_state_check
  CHECK (consumed_at IS NULL OR superseded_at IS NULL);

-- A consumed code was never exhausted: consumption requires
-- attempt_count < max_attempts, and a consumed code gains no attempts.
ALTER TABLE public.operator_verification_codes
  DROP CONSTRAINT IF EXISTS operator_verification_codes_consumed_attempts_check;
ALTER TABLE public.operator_verification_codes
  ADD CONSTRAINT operator_verification_codes_consumed_attempts_check
  CHECK (consumed_at IS NULL OR attempt_count < max_attempts);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes — each backs a known query or invariant
-- ─────────────────────────────────────────────────────────────────────────────

-- At most one current code per lifecycle (backstop for the serialized
-- issuance function). Also the current-code lookup for verification and
-- the target of the supersede UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS operator_verification_codes_one_current_per_lifecycle_uidx
  ON public.operator_verification_codes (lifecycle_id)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;

-- At most one consumed code per lifecycle, ever — a lifecycle can't be
-- verified twice.
CREATE UNIQUE INDEX IF NOT EXISTS operator_verification_codes_one_consumed_per_lifecycle_uidx
  ON public.operator_verification_codes (lifecycle_id)
  WHERE consumed_at IS NOT NULL;

-- Per-lifecycle send history: max(issued_at) for the cooldown and
-- count(issued_at > now - 60 min) for the rolling cap, both inside
-- issue_operator_verification_code(); lifecycle history for a future
-- Control Panel view. Also covers the lifecycle_id foreign key.
CREATE INDEX IF NOT EXISTS operator_verification_codes_lifecycle_issued_at_idx
  ON public.operator_verification_codes (lifecycle_id, issued_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Atomic issuance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_operator_verification_code(
  p_lifecycle_id UUID,
  p_code_digest  TEXT,
  p_request_ip   TEXT DEFAULT NULL
)
RETURNS TABLE (
  outcome             TEXT,
  code_id             UUID,
  code_expires_at     TIMESTAMPTZ,
  resend_available_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lifecycle        public.operator_activation_lifecycles%ROWTYPE;
  v_activated_at     TIMESTAMPTZ;
  v_now              TIMESTAMPTZ;
  v_last_issued_at   TIMESTAMPTZ;
  v_window_count     INTEGER;
  v_oldest_in_window TIMESTAMPTZ;
BEGIN
  IF p_code_digest IS NULL OR p_code_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'issue_operator_verification_code: invalid code digest'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize every code operation for this lifecycle.
  SELECT l.* INTO v_lifecycle
    FROM public.operator_activation_lifecycles l
   WHERE l.id = p_lifecycle_id
     FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'lifecycle_not_found'; RETURN NEXT; RETURN;
  END IF;

  v_now := clock_timestamp();

  SELECT o.account_activated_at INTO v_activated_at
    FROM public.operators o
   WHERE o.id = v_lifecycle.operator_id;

  IF v_lifecycle.released_at IS NOT NULL
     OR v_lifecycle.expired_at IS NOT NULL
     OR v_lifecycle.deadline_at <= v_now THEN
    outcome := 'lifecycle_closed'; RETURN NEXT; RETURN;
  END IF;
  IF v_activated_at IS NOT NULL THEN
    outcome := 'already_activated'; RETURN NEXT; RETURN;
  END IF;
  IF NOT v_lifecycle.verification_required THEN
    outcome := 'verification_not_required'; RETURN NEXT; RETURN;
  END IF;
  IF v_lifecycle.verification_completed_at IS NOT NULL THEN
    outcome := 'already_verified'; RETURN NEXT; RETURN;
  END IF;

  -- 60-second resend cooldown (exact boundary allowed).
  SELECT max(c.issued_at) INTO v_last_issued_at
    FROM public.operator_verification_codes c
   WHERE c.lifecycle_id = p_lifecycle_id;
  IF v_last_issued_at IS NOT NULL AND v_now < v_last_issued_at + interval '60 seconds' THEN
    outcome := 'cooldown';
    resend_available_at := v_last_issued_at + interval '60 seconds';
    RETURN NEXT; RETURN;
  END IF;

  -- 5 sends per rolling 60 minutes (a send exactly 60 minutes old is outside).
  SELECT count(*), min(c.issued_at) INTO v_window_count, v_oldest_in_window
    FROM public.operator_verification_codes c
   WHERE c.lifecycle_id = p_lifecycle_id
     AND c.issued_at > v_now - interval '60 minutes';
  IF v_window_count >= 5 THEN
    outcome := 'rate_limited';
    resend_available_at := v_oldest_in_window + interval '60 minutes';
    RETURN NEXT; RETURN;
  END IF;

  -- Supersede + insert in this same transaction.
  UPDATE public.operator_verification_codes c
     SET superseded_at = v_now
   WHERE c.lifecycle_id = p_lifecycle_id
     AND c.consumed_at IS NULL
     AND c.superseded_at IS NULL;

  INSERT INTO public.operator_verification_codes
    (lifecycle_id, code_digest, issued_at, expires_at, max_attempts, request_ip)
  VALUES
    (p_lifecycle_id, p_code_digest, v_now, v_now + interval '10 minutes', 5, p_request_ip)
  RETURNING id, expires_at INTO code_id, code_expires_at;

  outcome := 'issued';
  resend_available_at := v_now + interval '60 seconds';
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.issue_operator_verification_code(UUID, TEXT, TEXT) IS
  'Atomically issues one email-verification code for an eligible '
  'email-code lifecycle: locks the lifecycle, checks eligibility, enforces '
  'the 60-second cooldown and 5-per-rolling-60-minutes cap, supersedes the '
  'current code, and inserts the new one in one transaction. Only an '
  '''issued'' outcome may be followed by an email. Never returns the digest '
  'or IP. service_role only.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Incorrect-attempt recording
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_operator_verification_code_failure(
  p_lifecycle_id UUID,
  p_code_id      UUID
)
RETURNS TABLE (
  outcome            TEXT,
  attempts_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lifecycle    public.operator_activation_lifecycles%ROWTYPE;
  v_code         public.operator_verification_codes%ROWTYPE;
  v_activated_at TIMESTAMPTZ;
  v_now          TIMESTAMPTZ;
  v_new_count    INTEGER;
BEGIN
  SELECT l.* INTO v_lifecycle
    FROM public.operator_activation_lifecycles l
   WHERE l.id = p_lifecycle_id
     FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'lifecycle_not_found'; RETURN NEXT; RETURN;
  END IF;

  v_now := clock_timestamp();

  SELECT o.account_activated_at INTO v_activated_at
    FROM public.operators o
   WHERE o.id = v_lifecycle.operator_id;

  IF v_lifecycle.released_at IS NOT NULL
     OR v_lifecycle.expired_at IS NOT NULL
     OR v_lifecycle.deadline_at <= v_now THEN
    outcome := 'lifecycle_closed'; RETURN NEXT; RETURN;
  END IF;
  IF v_activated_at IS NOT NULL THEN
    outcome := 'already_activated'; RETURN NEXT; RETURN;
  END IF;
  IF NOT v_lifecycle.verification_required THEN
    outcome := 'verification_not_required'; RETURN NEXT; RETURN;
  END IF;
  IF v_lifecycle.verification_completed_at IS NOT NULL THEN
    outcome := 'already_verified'; RETURN NEXT; RETURN;
  END IF;

  SELECT c.* INTO v_code
    FROM public.operator_verification_codes c
   WHERE c.id = p_code_id
     AND c.lifecycle_id = p_lifecycle_id
     FOR UPDATE;
  IF NOT FOUND OR v_code.consumed_at IS NOT NULL OR v_code.superseded_at IS NOT NULL THEN
    outcome := 'code_not_current'; RETURN NEXT; RETURN;
  END IF;
  IF v_now >= v_code.expires_at THEN
    outcome := 'code_expired'; RETURN NEXT; RETURN;
  END IF;
  IF v_code.attempt_count >= v_code.max_attempts THEN
    outcome := 'code_exhausted'; attempts_remaining := 0; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.operator_verification_codes c
     SET attempt_count = c.attempt_count + 1
   WHERE c.id = v_code.id
     AND c.consumed_at IS NULL
     AND c.superseded_at IS NULL
     AND c.attempt_count < c.max_attempts
  RETURNING c.attempt_count INTO v_new_count;
  IF NOT FOUND THEN
    -- Unreachable while the lifecycle lock is held; never report an unrecorded guess.
    RAISE EXCEPTION 'record_operator_verification_code_failure: code state changed'
      USING ERRCODE = '40001';
  END IF;

  outcome := 'incorrect';
  attempts_remaining := v_code.max_attempts - v_new_count;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_operator_verification_code_failure(UUID, UUID) IS
  'Incorrect-code path: under the lifecycle lock, increments attempt_count '
  'by exactly one for the given current, unexpired, unexhausted code. '
  'Consumed, superseded, or expired codes never gain attempts. '
  'service_role only.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Correct-code consumption (single-use verification)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_operator_verification_code(
  p_lifecycle_id UUID,
  p_code_id      UUID
)
RETURNS TABLE (
  outcome     TEXT,
  verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lifecycle    public.operator_activation_lifecycles%ROWTYPE;
  v_code         public.operator_verification_codes%ROWTYPE;
  v_activated_at TIMESTAMPTZ;
  v_now          TIMESTAMPTZ;
BEGIN
  SELECT l.* INTO v_lifecycle
    FROM public.operator_activation_lifecycles l
   WHERE l.id = p_lifecycle_id
     FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'lifecycle_not_found'; RETURN NEXT; RETURN;
  END IF;

  v_now := clock_timestamp();

  SELECT o.account_activated_at INTO v_activated_at
    FROM public.operators o
   WHERE o.id = v_lifecycle.operator_id;

  IF v_lifecycle.released_at IS NOT NULL
     OR v_lifecycle.expired_at IS NOT NULL
     OR v_lifecycle.deadline_at <= v_now THEN
    outcome := 'lifecycle_closed'; RETURN NEXT; RETURN;
  END IF;
  IF v_activated_at IS NOT NULL THEN
    outcome := 'already_activated'; RETURN NEXT; RETURN;
  END IF;
  IF NOT v_lifecycle.verification_required THEN
    outcome := 'verification_not_required'; RETURN NEXT; RETURN;
  END IF;
  IF v_lifecycle.verification_completed_at IS NOT NULL THEN
    outcome := 'already_verified'; RETURN NEXT; RETURN;
  END IF;

  SELECT c.* INTO v_code
    FROM public.operator_verification_codes c
   WHERE c.id = p_code_id
     AND c.lifecycle_id = p_lifecycle_id
     FOR UPDATE;
  IF NOT FOUND OR v_code.consumed_at IS NOT NULL OR v_code.superseded_at IS NOT NULL THEN
    outcome := 'code_not_current'; RETURN NEXT; RETURN;
  END IF;
  IF v_now >= v_code.expires_at THEN
    outcome := 'code_expired'; RETURN NEXT; RETURN;
  END IF;
  IF v_code.attempt_count >= v_code.max_attempts THEN
    outcome := 'code_exhausted'; RETURN NEXT; RETURN;
  END IF;

  -- attempt_count is deliberately NOT modified on the correct-code path.
  UPDATE public.operator_verification_codes c
     SET consumed_at = v_now
   WHERE c.id = v_code.id
     AND c.consumed_at IS NULL
     AND c.superseded_at IS NULL;

  UPDATE public.operator_activation_lifecycles l
     SET verification_completed_at = v_now
   WHERE l.id = p_lifecycle_id
     AND l.verification_required
     AND l.verification_completed_at IS NULL;
  IF NOT FOUND THEN
    -- Unreachable while the lifecycle lock is held; roll back the consume.
    RAISE EXCEPTION 'consume_operator_verification_code: lifecycle verification state changed'
      USING ERRCODE = '40001';
  END IF;

  outcome := 'verified';
  verified_at := v_now;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.consume_operator_verification_code(UUID, UUID) IS
  'Correct-code path: under the lifecycle lock, consumes the given current, '
  'unexpired, unexhausted code and sets verification_completed_at exactly '
  'once. Never modifies attempt_count. service_role only.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Row Level Security — internal-only
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_verification_codes ENABLE ROW LEVEL SECURITY;
-- No policy of any kind — RLS enabled + no policy = denied to anon/
-- authenticated; service_role bypasses RLS but holds SELECT only (below).


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Table GRANTs — new table (CLAUDE.md rule). Explicit REVOKE first: this
--    project's default privileges would otherwise grant anon/authenticated
--    full table privileges on creation. service_role is SELECT-only so every
--    write goes through the functions above.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.operator_verification_codes FROM PUBLIC;
REVOKE ALL ON public.operator_verification_codes FROM anon;
REVOKE ALL ON public.operator_verification_codes FROM authenticated;
REVOKE ALL ON public.operator_verification_codes FROM service_role;
GRANT SELECT ON public.operator_verification_codes TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Function EXECUTE — service_role only (see migrations 082/085/097 for
--    why PUBLIC alone is not enough in this project).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.issue_operator_verification_code(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_operator_verification_code_failure(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_operator_verification_code(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_operator_verification_code(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_operator_verification_code_failure(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_operator_verification_code(UUID, UUID)
  TO service_role;
