-- migration: 087_venues_onboarding_completion_override
--
-- Adds a durable, Founder/Admin-only manual override for venue onboarding
-- completion — Phase 1B of the Venue Funnel prep work (see Phase 1A
-- investigation). Complements, rather than replaces, the existing dynamic
-- onboarding calculation (isOnboardingComplete() in
-- operator-admin/src/lib/homepagePhase.ts):
--
--   effectiveOnboardingComplete = automaticOnboardingComplete OR manualOverrideActive
--
-- Presence of onboarding_completed_override_at is the single source of truth
-- for "a manual override is active" — there is deliberately no separate
-- onboarding_status enum column. Normal (non-overridden) venues have all four
-- columns NULL and behave exactly as they do today; the automatic calculation
-- is untouched by this migration.
--
-- Use case: a venue may legitimately never satisfy every automatic
-- requirement (e.g. a drink-only bar has no food specials to add) without
-- being "incomplete" in any meaningful sense. Rather than adding per-item
-- "Not Applicable" flags (deferred — see homepagePhase.ts's Option D comment
-- and the Phase 1A investigation), a Founder/Admin can mark the venue done as
-- a whole, with a recorded reason.
--
-- Columns:
--   onboarding_completed_override_at        — set = override active. NULL = no override (default state).
--   onboarding_completed_override_by        — auth.uid() of the founder/admin who applied the override.
--                                              No FK (mirrors venue_notes.created_by) — the actor is a
--                                              Supabase auth user (Control Panel admin), not an operators row.
--   onboarding_completed_override_by_email  — email snapshot at write time (denormalised for display,
--                                              mirrors venue_notes.created_by_email / platform_admins.revoked_by_email).
--   onboarding_completed_override_reason    — required by the application when the override is applied
--                                              (not enforced here at the DB level, matching every other
--                                              free-text reason column in this schema, e.g.
--                                              cancellation_reason, google_identity_reason).
--
-- Reversal: clearing all four columns back to NULL (clearOnboardingOverrideAction) returns the venue to
-- the normal dynamic onboarding calculation — no separate "reset" state is needed.
--
-- Founder/admin-only: all four columns are written exclusively via service-role
-- (createAdminClient()) from Control Panel server actions — never from operator-facing
-- forms. No RLS policy changes are needed since venues' existing RLS posture
-- already restricts writes this way (mirrors migration 080's google_identity_status).
--
-- Backfill: none needed — every existing venue continues to be evaluated purely
-- dynamically (all four new columns default to NULL for every existing row).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS onboarding_completed_override_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_override_by        UUID,
  ADD COLUMN IF NOT EXISTS onboarding_completed_override_by_email  TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed_override_reason    TEXT;

COMMENT ON COLUMN public.venues.onboarding_completed_override_at IS
  'Set when a Founder/Admin manually declares this venue onboarding-complete, regardless of the '
  'automatic requirements (happy hour times, business hours, operator photo, food + drink specials, '
  'published). NULL = no override; onboarding is calculated dynamically as it always has been. '
  'Effective onboarding completion = automatic OR (this IS NOT NULL). Founder/admin-controlled only.';

COMMENT ON COLUMN public.venues.onboarding_completed_override_by IS
  'auth.uid() of the Founder/Admin who applied the current override. NULL when no override is active. '
  'No FK — mirrors venue_notes.created_by (the actor is a Control Panel admin, not an operators row).';

COMMENT ON COLUMN public.venues.onboarding_completed_override_by_email IS
  'Email snapshot of the Founder/Admin who applied the current override, denormalised for display '
  '(mirrors venue_notes.created_by_email). NULL when no override is active.';

COMMENT ON COLUMN public.venues.onboarding_completed_override_reason IS
  'Free-text reason for the manual onboarding override, required by the application at write time '
  '(e.g. "Venue offers drink specials only; food specials are not applicable."). NULL when no override is active.';

-- Supports Action Center / Founder Dashboard onboarding-count queries filtering
-- or joining on override presence. Partial index — mirrors venues_cancelled_at_idx (045)
-- and venues_google_identity_status_idx (080).
CREATE INDEX IF NOT EXISTS venues_onboarding_completed_override_at_idx
  ON public.venues (onboarding_completed_override_at)
  WHERE onboarding_completed_override_at IS NOT NULL;
