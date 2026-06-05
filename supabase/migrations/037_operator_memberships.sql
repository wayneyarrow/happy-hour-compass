-- =============================================================================
-- Happy Hour Compass — Operator Memberships
-- Migration: 037_operator_memberships.sql
--
-- PURPOSE:
--   Adds operator_memberships as the foundation for multi-user operator access.
--   V1 supports one owner per operator (the original account holder) plus
--   plan-limited team members.
--
-- DESIGN NOTES:
--   - auth_user_id is nullable: NULL for pending invites, populated on acceptance.
--   - invite_token is a one-time-use hex string; cleared to NULL on acceptance.
--   - invited_by records which operator sent the invite (audit trail).
--   - (operator_id, email) UNIQUE prevents duplicate active/pending memberships
--     for the same email on the same operator.
--   - status = 'cancelled' removes the invite from counts (does not block re-invite).
--   - RLS enabled; app uses createAdminClient() (service-role) for all writes.
--
-- TRIGGER:
--   on_operator_created fires AFTER INSERT on operators to automatically create
--   an owner membership for every new operator account. Runs as SECURITY DEFINER
--   so it bypasses RLS on operator_memberships.
--
-- BACKFILL:
--   All existing operators are inserted as 'owner' with status='active'.
--   LEFT JOIN to auth.users captures auth_user_id where the email matches.
-- =============================================================================


-- ── 1. Create table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.operator_memberships (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID         NOT NULL
                             REFERENCES public.operators(id)
                             ON DELETE CASCADE,
  auth_user_id  UUID         REFERENCES auth.users(id)
                             ON DELETE SET NULL,
  email         TEXT         NOT NULL,
  full_name     TEXT,
  role          TEXT         NOT NULL DEFAULT 'member',
  status        TEXT         NOT NULL DEFAULT 'invited',
  invite_token  TEXT         UNIQUE,
  invited_by    UUID         REFERENCES public.operators(id)
                             ON DELETE SET NULL,
  invited_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT operator_memberships_role_check
    CHECK (role IN ('owner', 'member')),
  CONSTRAINT operator_memberships_status_check
    CHECK (status IN ('active', 'invited', 'cancelled')),
  CONSTRAINT operator_memberships_operator_email_key
    UNIQUE (operator_id, email)
);

COMMENT ON TABLE public.operator_memberships IS
  'Multi-user access records for operator accounts. '
  'V1: one owner per operator, plan-limited team members. '
  'invite_token is one-time use — cleared to NULL on acceptance.';

COMMENT ON COLUMN public.operator_memberships.auth_user_id IS
  'Supabase auth.users(id). NULL for pending invites; populated on acceptance.';

COMMENT ON COLUMN public.operator_memberships.role IS
  'owner: original account holder. member: invited team member.';

COMMENT ON COLUMN public.operator_memberships.status IS
  'active: accepted and has access. invited: pending invite. cancelled: revoked, token dead.';

COMMENT ON COLUMN public.operator_memberships.invite_token IS
  'Cryptographically secure hex token. One-time use — set to NULL on acceptance or cancellation.';

COMMENT ON COLUMN public.operator_memberships.invited_by IS
  'FK to operators(id) — which operator account sent this invite.';


-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS operator_memberships_operator_id_idx
  ON public.operator_memberships (operator_id);

CREATE INDEX IF NOT EXISTS operator_memberships_email_idx
  ON public.operator_memberships (email);

-- Partial index — only non-null tokens (pending invites).
CREATE INDEX IF NOT EXISTS operator_memberships_invite_token_idx
  ON public.operator_memberships (invite_token)
  WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS operator_memberships_auth_user_id_idx
  ON public.operator_memberships (auth_user_id)
  WHERE auth_user_id IS NOT NULL;


-- ── 3. updated_at trigger ─────────────────────────────────────────────────────
-- Reuses update_updated_at() defined in 001_initial_schema.sql.

CREATE TRIGGER operator_memberships_updated_at
  BEFORE UPDATE ON public.operator_memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 4. RLS ────────────────────────────────────────────────────────────────────
-- No permissive policies. App uses createAdminClient() (service-role bypass).

ALTER TABLE public.operator_memberships ENABLE ROW LEVEL SECURITY;


-- ── 5. Auto-create owner membership on new operator INSERT ────────────────────
-- Fires after every INSERT on operators so new accounts (from any creation path)
-- always get an owner membership row without requiring callers to remember.
-- SECURITY DEFINER allows the function to INSERT into operator_memberships
-- even though RLS is enabled and the caller may be an unprivileged session.

CREATE OR REPLACE FUNCTION public.create_owner_membership_on_operator_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.operator_memberships (
    operator_id,
    email,
    full_name,
    role,
    status,
    invited_at,
    accepted_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.name,
    'owner',
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (operator_id, email) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_owner_membership_on_operator_insert() IS
  'Automatically creates an owner membership row for every new operator account. '
  'ON CONFLICT DO NOTHING makes it idempotent.';

CREATE TRIGGER on_operator_created
  AFTER INSERT ON public.operators
  FOR EACH ROW
  EXECUTE FUNCTION public.create_owner_membership_on_operator_insert();


-- ── 6. Backfill existing operators as owners ─────────────────────────────────
-- Reads existing operators and creates owner membership rows.
-- LEFT JOIN to auth.users to capture auth_user_id where email matches.
-- ON CONFLICT DO NOTHING makes this idempotent (safe to re-run).

INSERT INTO public.operator_memberships (
  operator_id,
  auth_user_id,
  email,
  full_name,
  role,
  status,
  invited_at,
  accepted_at
)
SELECT
  o.id,
  u.id,
  o.email,
  o.name,
  'owner',
  'active',
  o.created_at,
  o.created_at
FROM public.operators o
LEFT JOIN auth.users u ON u.email = o.email
ON CONFLICT (operator_id, email) DO NOTHING;
