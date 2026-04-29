-- =============================================================================
-- Happy Hour Compass — Operator Impersonation Sessions
-- Migration: 018_operator_impersonation_sessions.sql
--
-- Purpose:
--   Audit log for Control Panel → Operator Admin impersonation sessions.
--   Allows founder/support users to act as a venue operator for support
--   purposes, with a full start/end audit trail.
--
-- Access model:
--   This table has NO RLS policies. It is accessed exclusively via the
--   service-role (admin) client in server-side code. It is never exposed
--   to the browser directly.
--
-- Two cases:
--   Case A — operator_id NOT NULL: venue has an owner; impersonation acts
--             as that operator.
--   Case B — operator_id NULL:     venue is unowned (orphan); founder edits
--             directly, scoped by venue_id.
--
-- Cookie model:
--   On session creation the route handler sets an httpOnly cookie
--   (imp_session_id = sessions.id). Every /admin/* server request validates
--   the session via this table before granting impersonated context.
-- =============================================================================

CREATE TABLE IF NOT EXISTS operator_impersonation_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One-time token (reserved for future URL-based exchange flows).
  -- Generated on creation; not used in the current POST-based flow.
  token           TEXT        UNIQUE NOT NULL,
  token_used_at   TIMESTAMPTZ,          -- null = not yet consumed

  -- Who is impersonating
  founder_user_id UUID,                 -- auth.users id of the CP admin (nullable for flexibility)
  founder_email   TEXT        NOT NULL,

  -- Whose context is being assumed
  -- NULL when the venue has no created_by_operator_id (Case B orphan support mode)
  operator_id     UUID        REFERENCES operators(id) ON DELETE SET NULL,

  -- Which venue is in scope
  venue_id        UUID        NOT NULL  REFERENCES venues(id) ON DELETE CASCADE,

  -- Session lifecycle
  started_at      TIMESTAMPTZ NOT NULL  DEFAULT now(),
  ended_at        TIMESTAMPTZ,          -- null while active; set on exit
  expires_at      TIMESTAMPTZ NOT NULL, -- hard expiry (default 8 hours from creation)

  -- Optional context for audit (future: prompt for reason in UI)
  reason          TEXT,

  created_at      TIMESTAMPTZ NOT NULL  DEFAULT now()
);

-- Index for fast per-session lookups (used on every admin request)
CREATE INDEX IF NOT EXISTS idx_imp_sessions_id
  ON operator_impersonation_sessions (id);

-- Index for token lookups (reserved for future URL-based flows)
CREATE INDEX IF NOT EXISTS idx_imp_sessions_token
  ON operator_impersonation_sessions (token)
  WHERE token_used_at IS NULL;

-- Index for audit queries: all sessions by a given founder
CREATE INDEX IF NOT EXISTS idx_imp_sessions_founder_email
  ON operator_impersonation_sessions (founder_email);

-- Index for audit queries: all sessions for a given venue
CREATE INDEX IF NOT EXISTS idx_imp_sessions_venue_id
  ON operator_impersonation_sessions (venue_id);
