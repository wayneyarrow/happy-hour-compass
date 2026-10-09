-- =============================================================================
-- Migration 109: Venue Plan Grants (Comp / Trial access) — Part 1
--
-- STATUS: not yet applied. Apply to the shared Supabase project only with
-- explicit authorization (see CLAUDE.md "Writes, migrations, and
-- configuration changes").
--
-- Founder-granted Pro/Premium access with NO credit card and NO Stripe
-- subscription. Two grant types:
--   comp  — complimentary access, optional end date (open-ended allowed)
--   trial — access with a REQUIRED end date
--
-- WHAT THIS DOES NOT TOUCH (load-bearing — see the Part 1 investigation):
--   - venue_subscriptions / operator_subscriptions / plan_change_events:
--     no column, trigger, function, or row changes. A grant is never a
--     subscription row, never a plan_change_events row, never revenue.
--   - Stripe webhook / checkout / portal / cancellation code paths.
--   Effective access = higher of (existing billing plan, active grant) is
--   resolved in application code (src/lib/planGrants/), never stored.
--
-- This migration:
--   1. public.venue_plan_grants — one row per grant, never deleted.
--   2. public.venue_plan_grant_events — append-only lifecycle history
--      (granted / extended / expiry_added / expiry_shortened / revoked /
--      cancelled_before_start / ownership_changed / venue_cancelled). Read
--      by the Control Panel venue timeline (projected at read time, never
--      copied into venue_notes) and by Part 2 (trial onboarding/conversion).
--   3. Three service_role-only SECURITY DEFINER write functions that lock
--      the venue row first, so concurrent founder actions serialize:
--        create_venue_plan_grant()
--        change_venue_plan_grant_end()   (extend / add expiry / shorten)
--        revoke_venue_plan_grant()       (revoke, or cancel before start)
--   3b. A BEFORE INSERT/UPDATE trigger on venue_plan_grants that refuses any
--      write leaving two un-revoked grants with overlapping access windows
--      for the same venue (defence in depth behind the functions' own
--      "one open grant" rule — it holds even for a future direct write).
--   4. An AFTER UPDATE trigger on public.venues that PERMANENTLY ends every
--      open grant when ownership changes away from an owner (release,
--      transfer, provisioning rollback, manual SQL) or the venue is
--      cancelled. Same transaction as the venue write, so it covers every
--      code path. Nothing anywhere clears revoked_at — a revoked grant can
--      never become active again, even if ownership later returns to the
--      same operator. Application code additionally checks the grant's
--      owner snapshot (operator_id + owner_claimed_at) at read time as a
--      fallback (src/lib/planGrants/grantState.ts).
--
-- Rules enforced here (application code mirrors them for UX, but these are
-- authoritative):
--   - Grants only on claimed, operator-owned, non-cancelled venues.
--   - plan_code ∈ {pro, premium}; trial requires ends_at; ends_at > starts_at.
--   - At most ONE open grant per venue (open = not revoked and not yet
--     ended: ends_at IS NULL OR ends_at > now). Scheduled and active grants
--     both count as open, so windows can never overlap.
--   - starts_at in the past is clamped to now (immediate grant).
--
-- "Started" (drives venue-scoped public content enforcement — computed in
-- application code, documented here because the schema is shaped for it):
--   a grant has started iff starts_at <= now AND (revoked_at IS NULL OR
--   revoked_at > starts_at). A grant cancelled before its start date never
--   starts and never activates enforcement. An immediate grant starts at
--   creation; revoking it afterwards still counts as started.
--
-- Access: service_role only (all reads/writes are server-side via
-- createAdminClient()). Tables are SELECT-only for service_role — every
-- write goes through the functions above (same pattern as migration 100).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLE: venue_plan_grants
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_plan_grants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Explicitly named: PostgREST embeds reference it by name
  -- (venue_plan_grants!venue_plan_grants_venue_id_fkey), because
  -- venue_plan_grant_events (FKs to both tables) would otherwise make the
  -- venues ↔ venue_plan_grants relationship ambiguous (PGRST201).
  venue_id          UUID        NOT NULL
                    CONSTRAINT venue_plan_grants_venue_id_fkey
                    REFERENCES public.venues(id) ON DELETE CASCADE,
  plan_code         TEXT        NOT NULL,
  grant_type        TEXT        NOT NULL,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ,
  reason            TEXT        NOT NULL,
  -- Owner snapshot at grant creation. A grant is only ever valid for the
  -- exact ownership it was created under (read-time fallback to the
  -- ownership trigger below). No FK: this is a historical snapshot.
  operator_id       UUID        NOT NULL,
  owner_claimed_at  TIMESTAMPTZ,
  created_by_email  TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Terminal. Set once, never cleared.
  revoked_at        TIMESTAMPTZ,
  end_reason        TEXT,
  revoked_by_email  TEXT,
  revoke_reason     TEXT,

  CONSTRAINT venue_plan_grants_plan_code_check
    CHECK (plan_code IN ('pro', 'premium')),
  CONSTRAINT venue_plan_grants_grant_type_check
    CHECK (grant_type IN ('comp', 'trial')),
  CONSTRAINT venue_plan_grants_trial_requires_end
    CHECK (grant_type <> 'trial' OR ends_at IS NOT NULL),
  CONSTRAINT venue_plan_grants_end_after_start
    CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT venue_plan_grants_reason_present
    CHECK (length(btrim(reason)) > 0),
  CONSTRAINT venue_plan_grants_end_reason_check
    CHECK (end_reason IS NULL OR end_reason IN ('revoked', 'ownership_changed', 'venue_cancelled')),
  CONSTRAINT venue_plan_grants_revocation_consistent
    CHECK ((revoked_at IS NULL) = (end_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS venue_plan_grants_venue_id_idx
  ON public.venue_plan_grants (venue_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS venue_plan_grants_unrevoked_idx
  ON public.venue_plan_grants (ends_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.venue_plan_grants IS
  'Founder-granted Comp/Trial Pro or Premium access (migration 109). Never a '
  'subscription and never revenue: venue_subscriptions stays the sole billing '
  'record. Effective access = higher of billing plan and an active grant, '
  'resolved in application code. Rows are never deleted; revoked_at is terminal.';
COMMENT ON COLUMN public.venue_plan_grants.starts_at IS
  'When access begins. Future = scheduled grant (no effect before this time).';
COMMENT ON COLUMN public.venue_plan_grants.ends_at IS
  'Exclusive end of access. NULL = open-ended (comp only). Expiry is enforced '
  'by read-time access checks; no scheduled job is required.';
COMMENT ON COLUMN public.venue_plan_grants.operator_id IS
  'Snapshot of venues.created_by_operator_id when the grant was created.';
COMMENT ON COLUMN public.venue_plan_grants.owner_claimed_at IS
  'Snapshot of venues.claimed_at when the grant was created. Every re-link '
  'rewrites claimed_at, so a mismatch means ownership changed since.';
COMMENT ON COLUMN public.venue_plan_grants.end_reason IS
  'Why revoked_at was set: revoked (founder), ownership_changed or '
  'venue_cancelled (venues trigger). revoked_at <= starts_at means the grant '
  'was cancelled before it ever started.';

CREATE TRIGGER venue_plan_grants_updated_at
  BEFORE UPDATE ON public.venue_plan_grants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLE: venue_plan_grant_events (append-only history)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_plan_grant_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id          UUID        NOT NULL REFERENCES public.venue_plan_grants(id) ON DELETE CASCADE,
  venue_id          UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL,
  -- NULL for system events (venues trigger).
  actor_email       TEXT,
  previous_ends_at  TIMESTAMPTZ,
  new_ends_at       TIMESTAMPTZ,
  note              TEXT,
  metadata_json     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT venue_plan_grant_events_type_check
    CHECK (event_type IN (
      'granted',
      'extended',
      'expiry_added',
      'expiry_shortened',
      'revoked',
      'cancelled_before_start',
      'ownership_changed',
      'venue_cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS venue_plan_grant_events_venue_idx
  ON public.venue_plan_grant_events (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS venue_plan_grant_events_grant_idx
  ON public.venue_plan_grant_events (grant_id, created_at);

COMMENT ON TABLE public.venue_plan_grant_events IS
  'Append-only Comp/Trial lifecycle history (migration 109). Written only by '
  'the grant functions and the venues ownership trigger. Expiry has no row: '
  'it is time-based and derived from venue_plan_grants.ends_at.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. create_venue_plan_grant()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_venue_plan_grant(
  p_venue_id     UUID,
  p_plan_code    TEXT,
  p_grant_type   TEXT,
  p_starts_at    TIMESTAMPTZ,
  p_ends_at      TIMESTAMPTZ,
  p_reason       TEXT,
  p_actor_email  TEXT
)
RETURNS TABLE (outcome TEXT, grant_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_venue   public.venues%ROWTYPE;
  v_now     TIMESTAMPTZ := clock_timestamp();
  v_starts  TIMESTAMPTZ;
  v_id      UUID;
BEGIN
  IF p_plan_code IS NULL OR p_plan_code NOT IN ('pro', 'premium') THEN
    outcome := 'invalid_plan'; RETURN NEXT; RETURN;
  END IF;
  IF p_grant_type IS NULL OR p_grant_type NOT IN ('comp', 'trial') THEN
    outcome := 'invalid_type'; RETURN NEXT; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    outcome := 'reason_required'; RETURN NEXT; RETURN;
  END IF;
  IF p_actor_email IS NULL OR length(btrim(p_actor_email)) = 0 THEN
    outcome := 'actor_required'; RETURN NEXT; RETURN;
  END IF;

  -- Serialize every grant write for this venue.
  SELECT v.* INTO v_venue FROM public.venues v WHERE v.id = p_venue_id FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'venue_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_venue.created_by_operator_id IS NULL THEN
    outcome := 'venue_unclaimed'; RETURN NEXT; RETURN;
  END IF;
  IF v_venue.cancelled_at IS NOT NULL THEN
    outcome := 'venue_cancelled'; RETURN NEXT; RETURN;
  END IF;

  v_starts := GREATEST(COALESCE(p_starts_at, v_now), v_now);

  IF p_grant_type = 'trial' AND p_ends_at IS NULL THEN
    outcome := 'trial_requires_end'; RETURN NEXT; RETURN;
  END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at <= v_starts THEN
    outcome := 'end_before_start'; RETURN NEXT; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.venue_plan_grants g
     WHERE g.venue_id = p_venue_id
       AND g.revoked_at IS NULL
       AND (g.ends_at IS NULL OR g.ends_at > v_now)
  ) THEN
    outcome := 'open_grant_exists'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.venue_plan_grants (
    venue_id, plan_code, grant_type, starts_at, ends_at, reason,
    operator_id, owner_claimed_at, created_by_email
  ) VALUES (
    p_venue_id, p_plan_code, p_grant_type, v_starts, p_ends_at, btrim(p_reason),
    v_venue.created_by_operator_id, v_venue.claimed_at, btrim(p_actor_email)
  )
  RETURNING id INTO v_id;

  INSERT INTO public.venue_plan_grant_events (
    grant_id, venue_id, event_type, actor_email, new_ends_at, note, metadata_json
  ) VALUES (
    v_id, p_venue_id, 'granted', btrim(p_actor_email), p_ends_at, btrim(p_reason),
    jsonb_build_object(
      'planCode',  p_plan_code,
      'grantType', p_grant_type,
      'startsAt',  v_starts,
      'scheduled', v_starts > v_now
    )
  );

  outcome := 'created'; grant_id := v_id; RETURN NEXT;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. change_venue_plan_grant_end() — extend / add expiry / shorten
--    p_expected_ends_at is a compare-and-swap guard (NULL = expecting an
--    open-ended grant), so two founders editing at once can't silently
--    clobber each other.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_venue_plan_grant_end(
  p_grant_id          UUID,
  p_venue_id          UUID,
  p_new_ends_at       TIMESTAMPTZ,
  p_expected_ends_at  TIMESTAMPTZ,
  p_note              TEXT,
  p_actor_email       TEXT
)
RETURNS TABLE (outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grant  public.venue_plan_grants%ROWTYPE;
  v_now    TIMESTAMPTZ := clock_timestamp();
  v_event  TEXT;
BEGIN
  IF p_actor_email IS NULL OR length(btrim(p_actor_email)) = 0 THEN
    outcome := 'actor_required'; RETURN NEXT; RETURN;
  END IF;
  IF p_new_ends_at IS NULL THEN
    outcome := 'end_required'; RETURN NEXT; RETURN;
  END IF;

  SELECT g.* INTO v_grant FROM public.venue_plan_grants g WHERE g.id = p_grant_id;
  -- The caller names the venue too, so a grant can never be changed (or
  -- audited) under a different venue than the one it belongs to.
  IF NOT FOUND OR v_grant.venue_id IS DISTINCT FROM p_venue_id THEN
    outcome := 'grant_not_found'; RETURN NEXT; RETURN;
  END IF;

  -- Same lock order as create (venue first), then re-read the grant.
  PERFORM 1 FROM public.venues v WHERE v.id = v_grant.venue_id FOR UPDATE;
  SELECT g.* INTO v_grant FROM public.venue_plan_grants g WHERE g.id = p_grant_id FOR UPDATE;

  IF v_grant.revoked_at IS NOT NULL THEN
    outcome := 'grant_revoked'; RETURN NEXT; RETURN;
  END IF;
  IF v_grant.ends_at IS NOT NULL AND v_grant.ends_at <= v_now THEN
    outcome := 'grant_ended'; RETURN NEXT; RETURN;
  END IF;
  IF v_grant.ends_at IS DISTINCT FROM p_expected_ends_at THEN
    outcome := 'stale'; RETURN NEXT; RETURN;
  END IF;
  IF p_new_ends_at <= v_now OR p_new_ends_at <= v_grant.starts_at THEN
    outcome := 'end_not_in_future'; RETURN NEXT; RETURN;
  END IF;
  IF v_grant.ends_at IS NOT NULL AND p_new_ends_at = v_grant.ends_at THEN
    outcome := 'unchanged'; RETURN NEXT; RETURN;
  END IF;

  v_event := CASE
    WHEN v_grant.ends_at IS NULL THEN 'expiry_added'
    WHEN p_new_ends_at > v_grant.ends_at THEN 'extended'
    ELSE 'expiry_shortened'
  END;

  UPDATE public.venue_plan_grants SET ends_at = p_new_ends_at WHERE id = p_grant_id;

  INSERT INTO public.venue_plan_grant_events (
    grant_id, venue_id, event_type, actor_email, previous_ends_at, new_ends_at, note
  ) VALUES (
    p_grant_id, v_grant.venue_id, v_event, btrim(p_actor_email),
    v_grant.ends_at, p_new_ends_at, NULLIF(btrim(COALESCE(p_note, '')), '')
  );

  outcome := v_event; RETURN NEXT;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. revoke_venue_plan_grant() — revoke an active grant, or cancel a
--    scheduled one before it starts (revoked_at <= starts_at ⇒ never started,
--    never activates enforcement).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_venue_plan_grant(
  p_grant_id     UUID,
  p_venue_id     UUID,
  p_reason       TEXT,
  p_actor_email  TEXT
)
RETURNS TABLE (outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grant  public.venue_plan_grants%ROWTYPE;
  v_now    TIMESTAMPTZ := clock_timestamp();
  v_event  TEXT;
BEGIN
  IF p_actor_email IS NULL OR length(btrim(p_actor_email)) = 0 THEN
    outcome := 'actor_required'; RETURN NEXT; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    outcome := 'reason_required'; RETURN NEXT; RETURN;
  END IF;

  SELECT g.* INTO v_grant FROM public.venue_plan_grants g WHERE g.id = p_grant_id;
  IF NOT FOUND OR v_grant.venue_id IS DISTINCT FROM p_venue_id THEN
    outcome := 'grant_not_found'; RETURN NEXT; RETURN;
  END IF;

  PERFORM 1 FROM public.venues v WHERE v.id = v_grant.venue_id FOR UPDATE;
  SELECT g.* INTO v_grant FROM public.venue_plan_grants g WHERE g.id = p_grant_id FOR UPDATE;

  IF v_grant.revoked_at IS NOT NULL THEN
    outcome := 'grant_revoked'; RETURN NEXT; RETURN;
  END IF;
  IF v_grant.ends_at IS NOT NULL AND v_grant.ends_at <= v_now THEN
    outcome := 'grant_ended'; RETURN NEXT; RETURN;
  END IF;

  v_event := CASE WHEN v_now <= v_grant.starts_at THEN 'cancelled_before_start' ELSE 'revoked' END;

  UPDATE public.venue_plan_grants
     SET revoked_at = v_now,
         end_reason = 'revoked',
         revoked_by_email = btrim(p_actor_email),
         revoke_reason = btrim(p_reason)
   WHERE id = p_grant_id;

  INSERT INTO public.venue_plan_grant_events (
    grant_id, venue_id, event_type, actor_email, previous_ends_at, note
  ) VALUES (
    p_grant_id, v_grant.venue_id, v_event, btrim(p_actor_email), v_grant.ends_at, btrim(p_reason)
  );

  outcome := v_event; RETURN NEXT;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5b. No overlapping access windows (defence in depth)
--
-- A grant's access window is [starts_at, LEAST(ends_at, revoked_at)) —
-- open-ended when both are NULL. Any INSERT/UPDATE that would leave an
-- un-revoked grant overlapping another grant's window on the same venue is
-- refused (SQLSTATE 23P01, exclusion_violation). Locks the venue row first —
-- the same lock every grant function takes — so two concurrent writers can
-- never both pass the check. A grant cancelled before it started has an
-- empty window and never conflicts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_plan_grants_prevent_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_end TIMESTAMPTZ;
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    RETURN NEW;  -- revocation only ever shortens a window
  END IF;

  PERFORM 1 FROM public.venues v WHERE v.id = NEW.venue_id FOR UPDATE;

  v_new_end := COALESCE(NEW.ends_at, 'infinity'::timestamptz);

  IF EXISTS (
    SELECT 1
      FROM public.venue_plan_grants g
     WHERE g.venue_id = NEW.venue_id
       AND g.id <> NEW.id
       AND COALESCE(LEAST(g.ends_at, g.revoked_at), 'infinity'::timestamptz) > g.starts_at
       AND g.starts_at < v_new_end
       AND NEW.starts_at < COALESCE(LEAST(g.ends_at, g.revoked_at), 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'venue_plan_grants: overlapping grant window for venue %', NEW.venue_id
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER venue_plan_grants_no_overlap
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, revoked_at, venue_id ON public.venue_plan_grants
  FOR EACH ROW EXECUTE FUNCTION public.venue_plan_grants_prevent_overlap();


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Permanent invalidation on release / ownership transfer / cancellation
--
-- Fires only when ownership changes AWAY from a non-null owner, or the venue
-- becomes cancelled. A first claim (NULL → owner) never fires it. Ends every
-- OPEN grant (scheduled or active); grants already expired/revoked are left
-- untouched. A scheduled grant ended here has revoked_at <= starts_at, so it
-- never started and never activates enforcement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_plan_grants_end_on_venue_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason TEXT;
  v_now    TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF (OLD.created_by_operator_id IS NOT NULL
        AND OLD.created_by_operator_id IS DISTINCT FROM NEW.created_by_operator_id)
     OR (OLD.claimed_by IS NOT NULL
        AND OLD.claimed_by IS DISTINCT FROM NEW.claimed_by) THEN
    v_reason := 'ownership_changed';
  ELSIF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
    v_reason := 'venue_cancelled';
  ELSE
    RETURN NEW;
  END IF;

  WITH ended AS (
    UPDATE public.venue_plan_grants g
       SET revoked_at = v_now,
           end_reason = v_reason
     WHERE g.venue_id = NEW.id
       AND g.revoked_at IS NULL
       AND (g.ends_at IS NULL OR g.ends_at > v_now)
    RETURNING g.id, g.ends_at
  )
  INSERT INTO public.venue_plan_grant_events (
    grant_id, venue_id, event_type, previous_ends_at, metadata_json
  )
  SELECT e.id, NEW.id, v_reason, e.ends_at,
         jsonb_build_object(
           'previousOperatorId', OLD.created_by_operator_id,
           'newOperatorId',      NEW.created_by_operator_id
         )
    FROM ended e;

  RETURN NEW;
END;
$$;

CREATE TRIGGER venues_end_plan_grants_on_change
  AFTER UPDATE OF created_by_operator_id, claimed_by, cancelled_at ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.venue_plan_grants_end_on_venue_change();


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — enabled, no policies (service_role only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_plan_grants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_plan_grant_events ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Table GRANTs — new tables (CLAUDE.md rule). Explicit REVOKE first: this
--    project's default privileges would otherwise grant anon/authenticated
--    full table privileges on creation. service_role is SELECT-only so every
--    write goes through the functions/trigger above.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.venue_plan_grants FROM PUBLIC;
REVOKE ALL ON public.venue_plan_grants FROM anon;
REVOKE ALL ON public.venue_plan_grants FROM authenticated;
REVOKE ALL ON public.venue_plan_grants FROM service_role;
GRANT SELECT ON public.venue_plan_grants TO service_role;

REVOKE ALL ON public.venue_plan_grant_events FROM PUBLIC;
REVOKE ALL ON public.venue_plan_grant_events FROM anon;
REVOKE ALL ON public.venue_plan_grant_events FROM authenticated;
REVOKE ALL ON public.venue_plan_grant_events FROM service_role;
GRANT SELECT ON public.venue_plan_grant_events TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Function EXECUTE. Five functions in total:
--      callable (service_role only — see migrations 082/085/097/100 for why
--      revoking from PUBLIC alone is not enough in this project; this
--      project's default privileges grant EXECUTE on every new function to
--      anon/authenticated/service_role):
--        create_venue_plan_grant, change_venue_plan_grant_end,
--        revoke_venue_plan_grant
--      trigger-only (no role needs EXECUTE — Postgres checks it only when a
--      trigger is created, never when it fires, and refuses a direct call of
--      a RETURNS TRIGGER function anyway), revoked from every client role
--      including service_role:
--        venue_plan_grants_end_on_venue_change, venue_plan_grants_prevent_overlap
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_venue_plan_grant(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.change_venue_plan_grant_end(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_venue_plan_grant(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.venue_plan_grants_end_on_venue_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.venue_plan_grants_prevent_overlap()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_venue_plan_grant(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.change_venue_plan_grant_end(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_venue_plan_grant(UUID, UUID, TEXT, TEXT)
  TO service_role;
