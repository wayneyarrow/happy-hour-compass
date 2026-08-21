-- =============================================================================
-- Migration: 079_consumer_structured_names.sql
--
-- Adds structured first_name / last_name columns to consumer_profiles,
-- alongside the existing display_name field — display_name is retained
-- unchanged for backward compatibility, not removed or replaced.
--
-- Both new columns are nullable TEXT — never NOT NULL:
--   - Some existing display_name values are a single token (no reliable
--     last name to derive).
--   - At least one existing profile has no usable display_name at all.
--   - Forcing an invented value into either column would misrepresent a
--     real person's name — never acceptable.
--
-- Going forward, first_name/last_name become the canonical source for
-- personalization (e.g. Brevo FIRSTNAME/LASTNAME) — display_name continues
-- to be derived from them at write time by application code, but is not
-- touched by this migration for existing rows (see backfill below).
--
-- BACKFILL (existing rows only — this migration never touches a row that
-- already has first_name or last_name set, so it cannot clobber a value
-- set by application code after this migration runs):
--   - display_name with exactly two whitespace-separated tokens
--     ("Mindy Green") -> first_name = "Mindy", last_name = "Green".
--   - display_name with exactly one token ("Mindy") -> first_name =
--     "Mindy", last_name = NULL. Never invents a last name.
--   - display_name that is NULL/blank, OR has three or more tokens ->
--     first_name = NULL, last_name = NULL. Three-plus-token names are
--     deliberately NOT auto-split — there is no reliable, general rule for
--     which token(s) are the given name vs. family name (compound
--     surnames, middle names, suffixes, etc.), so guessing would risk
--     silently misassigning part of a real person's name. Read-only
--     verification immediately before this migration was written/applied
--     confirmed 0 such rows existed in the live dataset (29 total profiles,
--     28 populated display_name, 8 single-token, 20 two-token, 0
--     three-plus-token, 1 blank) — if any exist by the time this actually
--     runs, they are safely left unset here rather than guessed.
--
-- display_name itself is never modified or deleted by this migration — it
-- remains exactly as it was, for any existing code that still reads it.
--
-- Idempotent: the backfill only ever targets rows where BOTH first_name
-- and last_name are still NULL, deterministically recomputed from the
-- current display_name. Safe to re-run; never overwrites a row that has
-- already been backfilled or has since been set by application code
-- (e.g. a consumer who edited their profile between this migration being
-- written and applied).
--
-- GRANTs: no new GRANT statements needed. This is a column addition on an
-- existing table (051_consumer_accounts_foundation.sql already granted
-- SELECT/INSERT/UPDATE on public.consumer_profiles to `authenticated` and
-- ALL to `service_role`) — Postgres GRANTs are table-scoped, not
-- column-scoped, so the existing grants already cover these columns.
-- =============================================================================

ALTER TABLE public.consumer_profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_name  TEXT NULL;

COMMENT ON COLUMN public.consumer_profiles.first_name IS
  'Structured given name. Canonical source for personalization (e.g. Brevo FIRSTNAME) going forward. Nullable — never invented. Backfilled once from display_name at migration time (see 079_consumer_structured_names.sql); populated directly by application code for new signups and profile edits thereafter.';

COMMENT ON COLUMN public.consumer_profiles.last_name IS
  'Structured family name. Canonical source for personalization (e.g. Brevo LASTNAME) going forward. Nullable — a consumer with only a first name legitimately has no last_name value; never invented. See first_name comment.';

-- Backfill existing rows only. Deterministic and idempotent — recomputes
-- from the current display_name every time, guarded so it only ever
-- touches a row that has never been backfilled or edited
-- (first_name IS NULL AND last_name IS NULL).
UPDATE public.consumer_profiles
SET
  first_name = CASE
    WHEN display_name IS NULL OR trim(display_name) = '' THEN NULL
    WHEN array_length(regexp_split_to_array(trim(display_name), '\s+'), 1) = 1
      THEN trim(display_name)
    WHEN array_length(regexp_split_to_array(trim(display_name), '\s+'), 1) = 2
      THEN (regexp_split_to_array(trim(display_name), '\s+'))[1]
    ELSE NULL  -- 3+ tokens: never auto-split, see header comment
  END,
  last_name = CASE
    WHEN display_name IS NOT NULL
      AND array_length(regexp_split_to_array(trim(display_name), '\s+'), 1) = 2
      THEN (regexp_split_to_array(trim(display_name), '\s+'))[2]
    ELSE NULL  -- blank/null, single-token, and 3+-token names all get NULL last_name
  END
WHERE first_name IS NULL AND last_name IS NULL;
