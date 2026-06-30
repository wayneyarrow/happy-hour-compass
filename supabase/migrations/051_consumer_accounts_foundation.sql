-- =============================================================================
-- 051_consumer_accounts_foundation.sql
--
-- Creates the database foundation for consumer accounts and saved items.
--
-- V1 principle: users can save venues/events without creating an account.
-- Saving works locally in the browser (localStorage) first. Consumer accounts
-- are optional and exist to sync saved items across devices. Accounts are
-- never required to browse, search, or use core HHC discovery.
--
-- Tables created:
--   public.consumer_profiles      — one row per authenticated consumer (links to auth.users)
--   public.consumer_saved_venues  — venues a consumer has saved
--   public.consumer_saved_events  — events a consumer has saved
--
-- RLS: all three tables have RLS enabled. Policies scope every operation to
-- the authenticated user's own rows only. No broad public access is granted.
--
-- GRANTs: anon is excluded (these tables are login-gated). authenticated gets
-- the minimum operations each table actually needs. service_role gets ALL.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: consumer_profiles
-- One row per consumer who has created an account. Backed by auth.users.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consumer_profiles (
  id                    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                 TEXT,
  display_name          TEXT        NULL,
  selected_market_slug  TEXT        NULL,
  marketing_consent     BOOLEAN     NOT NULL DEFAULT false,
  marketing_consent_at  TIMESTAMPTZ NULL,
  terms_accepted_at     TIMESTAMPTZ NULL,
  privacy_accepted_at   TIMESTAMPTZ NULL,
  last_login_at         TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consumer_profiles IS 'One row per authenticated consumer. Linked to auth.users. Created on first login or account creation.';

CREATE TRIGGER consumer_profiles_updated_at
  BEFORE UPDATE ON public.consumer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: consumer_saved_venues
-- Venues a consumer has saved to their account.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consumer_saved_venues (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id  UUID        NOT NULL REFERENCES public.consumer_profiles(id) ON DELETE CASCADE,
  venue_id     UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, venue_id)
);

COMMENT ON TABLE public.consumer_saved_venues IS 'Venues saved by a consumer to their account. Populated when local saves are synced on login.';


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: consumer_saved_events
-- Events a consumer has saved to their account.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consumer_saved_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id  UUID        NOT NULL REFERENCES public.consumer_profiles(id) ON DELETE CASCADE,
  event_id     UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, event_id)
);

COMMENT ON TABLE public.consumer_saved_events IS 'Events saved by a consumer to their account. Populated when local saves are synced on login.';


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- RLS is enabled on all three tables. Every policy scopes to the authenticated
-- user's own row only. No anon access is permitted — these tables are login-gated.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.consumer_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumer_saved_venues  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumer_saved_events  ENABLE ROW LEVEL SECURITY;


-- consumer_profiles policies
CREATE POLICY "consumer_profiles: select own"
  ON public.consumer_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "consumer_profiles: insert own"
  ON public.consumer_profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "consumer_profiles: update own"
  ON public.consumer_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- consumer_saved_venues policies
CREATE POLICY "consumer_saved_venues: select own"
  ON public.consumer_saved_venues FOR SELECT TO authenticated
  USING (consumer_id = auth.uid());

CREATE POLICY "consumer_saved_venues: insert own"
  ON public.consumer_saved_venues FOR INSERT TO authenticated
  WITH CHECK (consumer_id = auth.uid());

CREATE POLICY "consumer_saved_venues: delete own"
  ON public.consumer_saved_venues FOR DELETE TO authenticated
  USING (consumer_id = auth.uid());


-- consumer_saved_events policies
CREATE POLICY "consumer_saved_events: select own"
  ON public.consumer_saved_events FOR SELECT TO authenticated
  USING (consumer_id = auth.uid());

CREATE POLICY "consumer_saved_events: insert own"
  ON public.consumer_saved_events FOR INSERT TO authenticated
  WITH CHECK (consumer_id = auth.uid());

CREATE POLICY "consumer_saved_events: delete own"
  ON public.consumer_saved_events FOR DELETE TO authenticated
  USING (consumer_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs
-- anon is excluded — all three tables are login-gated.
-- authenticated gets minimum required operations per table.
-- service_role gets ALL on all tables (bypasses RLS; required for admin ops).
-- ─────────────────────────────────────────────────────────────────────────────

-- consumer_profiles: authenticated users can read, create, and update their profile
GRANT SELECT, INSERT, UPDATE       ON public.consumer_profiles     TO authenticated;
GRANT ALL                          ON public.consumer_profiles     TO service_role;

-- consumer_saved_venues: authenticated users can read, add, and remove saved venues
GRANT SELECT, INSERT, DELETE       ON public.consumer_saved_venues  TO authenticated;
GRANT ALL                          ON public.consumer_saved_venues  TO service_role;

-- consumer_saved_events: authenticated users can read, add, and remove saved events
GRANT SELECT, INSERT, DELETE       ON public.consumer_saved_events  TO authenticated;
GRANT ALL                          ON public.consumer_saved_events  TO service_role;
