-- =============================================================================
-- Migration 040: Platform Admins
--
-- Adds the platform_admins table for DB-backed Control Panel access.
--
-- Replaces (but does not remove) the CONTROL_PANEL_ADMIN_EMAILS env-var allowlist.
-- The env-var remains as an emergency fallback: any email in the env var will
-- always be granted CP access even if no DB record exists.
--
-- Access model:
--   status = 'active'  → full Control Panel access
--   status = 'invited' → invite is pending acceptance; no CP access yet
--   status = 'revoked' → access permanently revoked; env-var fallback still works
--
-- Token pattern:
--   invite_token is a random hex string (64 chars / 32 bytes).
--   It is stored here (not hashed) because the token grants no server-side
--   permissions on its own — it only activates an already-vetted invite row.
--   Cleared to NULL on acceptance or revocation.
--
-- Seed: wayner.yarrow@gmail.com is inserted as an active admin.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: platform_admins
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT        NOT NULL UNIQUE,
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'invited', 'revoked')),
  invited_by_email  TEXT,
  invite_token      TEXT        UNIQUE,           -- cleared on acceptance/revocation
  invite_expires_at TIMESTAMPTZ,
  invited_at        TIMESTAMPTZ,
  accepted_at       TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_by_email  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.platform_admins IS
  'DB-backed allowlist for Control Panel (platform admin) access. '
  'Complements (does not replace) the CONTROL_PANEL_ADMIN_EMAILS env-var fallback.';

COMMENT ON COLUMN public.platform_admins.status IS
  'active = full CP access; invited = pending acceptance; revoked = access removed.';
COMMENT ON COLUMN public.platform_admins.invite_token IS
  'Single-use 64-char hex token sent in the invite email. Cleared on acceptance or revocation.';
COMMENT ON COLUMN public.platform_admins.invite_expires_at IS
  'Token expiry — 7 days from invite creation. Acceptance rejected after this time.';


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER platform_admins_updated_at
  BEFORE UPDATE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEX: fast invite-token lookup on the acceptance page
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS platform_admins_invite_token_idx
  ON public.platform_admins (invite_token)
  WHERE invite_token IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Internal-only table: no anon or authenticated direct access.
-- All reads/writes go through createAdminClient() (service-role).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- No permissive policies — service-role bypasses RLS and is the only caller.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (required — see migration 039 + CLAUDE.md)
-- Internal-only: service_role only.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.platform_admins TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Wayne's account is the bootstrap active admin.
-- ON CONFLICT DO NOTHING is safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.platform_admins (email, status, created_at, updated_at)
VALUES ('wayner.yarrow@gmail.com', 'active', now(), now())
ON CONFLICT (email) DO NOTHING;
