-- =============================================================================
-- Happy Hour Compass — Daily Specials Data Foundation (Phase 1)
-- Migration: 091_daily_specials_foundation.sql
--
-- CONTEXT:
--   Introduces Daily Specials as a new, first-class, venue-owned content
--   type alongside Happy Hours (columns on venues) and Events (public.events).
--   Per the approved architecture investigation and the Phase 1 task brief,
--   Daily Specials are a SEPARATE table from events — they are not stored in
--   public.events and events is not modified by this migration.
--
--   This migration is Phase 1 (data foundation only). No Operator Admin UI,
--   consumer UI, homepage rail, analytics, or seeding workflow exists yet —
--   this table exists so those later phases have a stable, validated
--   foundation to build on.
--
-- LOCKED PRODUCT DECISIONS THIS SCHEMA ENCODES:
--   - No individual "offer item" child table. The offer itself is entirely
--     represented by title / short_summary / description / conditions —
--     free text, same philosophy as venues.hh_food_details/hh_drink_details
--     already use for Happy Hour offer content, deliberately NOT normalized
--     into priced line items.
--   - No public detail page, so no slug / slug-history is introduced (unlike
--     events.slug + event_slug_history). A future venue-detail deep link
--     will anchor on this table's own `id` (e.g. "#daily-special-<id>") —
--     `id` therefore needs no additional stable identifier of its own.
--   - Scheduling v1 supports exactly two schedule_type values: 'one_time'
--     and 'weekly'. Unlike events.recurrence (a loose, unconstrained TEXT
--     column with app-level-only validation — see recurrenceUtils.ts),
--     schedule_type is deliberately closed via CHECK now, and weekly
--     recurrence carries a genuine MULTI-weekday array (days_of_week),
--     not a single day inferred from a date the way events.recurrence
--     ='weekly' infers its one day from first_date. This is a deliberate,
--     approved departure from the events pattern, not an oversight — see
--     the Phase 1 task brief, "Do NOT copy Events' single-weekday
--     recurrence limitation."
--   - Time is stored as real TIME values (start_time/end_time), not TEXT
--     labels like events.start_time/end_time ("7:00 PM"). "Close" is a
--     semantic end_mode value ('close'), never a copied clock time — see
--     the TIME MODEL section below. This is a deliberate, approved
--     departure from the events time-storage pattern.
--   - is_seeded_special mirrors events.is_seeded_event's semantics exactly,
--     for the same grandfathered-recurrence entitlement pattern
--     (src/lib/plans.ts, extended in this phase for Daily Specials).
--   - source_url / last_verified_at are new provenance/freshness columns
--     with no events equivalent — added because seeded Daily Specials are
--     expected to need freshness review sooner than seeded venue/HH data
--     does. No staleness automation is built by this migration — the
--     columns are storage only.
--
-- SCHEDULE MODEL — CHECK constraint reference (see
-- daily_specials_schedule_fields_check below):
--   schedule_type = 'one_time':
--     one_time_date IS NOT NULL
--     days_of_week / recurrence_start_date / recurrence_end_date are NULL
--   schedule_type = 'weekly':
--     one_time_date IS NULL
--     days_of_week IS NOT NULL AND has at least one element (0-6, no dupes)
--     recurrence_start_date / recurrence_end_date are optional; if both are
--     present, recurrence_end_date >= recurrence_start_date
--       NULL recurrence_start_date = already active / no start boundary
--       NULL recurrence_end_date   = continues indefinitely
--
-- TIME MODEL — CHECK constraints reference (see
-- daily_specials_end_mode_check / daily_specials_time_mode_check /
-- daily_specials_timed_boundary_check below). Worked examples from the task
-- brief, all satisfied by these three constraints together:
--   Wednesday                 -> time_mode=unspecified, start/end NULL, end_mode=unspecified
--   Wednesday - All Day       -> time_mode=all_day,      start/end NULL, end_mode=unspecified
--   Wednesday - From 4 PM     -> time_mode=timed, start_time=16:00, end_mode=unspecified, end_time=NULL
--   Wednesday - Until 1 PM    -> time_mode=timed, start_time=NULL,  end_mode=time, end_time=13:00
--   Wednesday - 4 PM-9 PM     -> time_mode=timed, start_time=16:00, end_mode=time, end_time=21:00
--   Wednesday - 4 PM-Close    -> time_mode=timed, start_time=16:00, end_mode=close, end_time=NULL
--   A "timed" row with no start_time and end_mode='unspecified' (a
--   meaningless boundary-free "timed" row) is rejected.
--   "Close" never stores or derives a clock time — no join to venues'
--   business_hours happens here or anywhere in this migration. A future
--   "Available Now" feature resolving end_mode='close' against the venue's
--   actual hours at read time is explicitly deferred (see task brief §7,
--   §22) and this schema does not block it — start_time/end_time being real
--   TIME columns (not TEXT) is exactly what keeps that future comparison
--   straightforward.
--
-- SECURITY (RLS) — deliberate deviation from the literal events precedent:
--   071_events_venue_ownership_rls.sql fixed events' UPDATE/DELETE policies
--   to authorize by venue ownership instead of created_by_operator_id
--   (created_by_operator_id is NULL for every seeded row, so scoping by it
--   silently denied seeded-row access to the operator managing that venue).
--   That corrected venue-ownership USING/WITH CHECK shape is reused here
--   VERBATIM for UPDATE and DELETE.
--
--   events' SELECT ("events: authenticated read", USING (TRUE)) and INSERT
--   ("events: insert authenticated", WITH CHECK (TRUE)) policies were left
--   permissive by 071 — 071's own header explains this was deliberate
--   (ownership was never broken for SELECT, since it was never scoped in
--   the first place; INSERT ownership was already correctly enforced by
--   application code setting created_by_operator_id, not by RLS). That
--   permissive shape traces back to 001_initial_schema.sql's original
--   comment: "Refine this to 'own venues only' once ownership queries are
--   optimised" — a known placeholder never tightened for venues/events.
--
--   daily_specials is a brand-new table with no such legacy placeholder to
--   preserve, and the Phase 1 task brief is explicit that "Daily Special
--   permissions must be based on venue ownership" for the policy set as a
--   whole. This migration therefore scopes ALL FOUR policies (SELECT,
--   INSERT, UPDATE, DELETE) to venue ownership, not just UPDATE/DELETE —
--   a deliberately stricter posture than events', made possible only
--   because there is no pre-existing looser policy to break compatibility
--   with. Every current and anticipated authenticated caller (Operator
--   Admin, acting on the operator's own venues) is unaffected, since it
--   never reads/writes another operator's venue's rows; every consumer-
--   facing and Control Panel read goes through createAdminClient()
--   (service-role), which bypasses RLS entirely and is unaffected by this
--   choice either way. See the migration's own POLICY blocks below for the
--   exact predicate, and the Phase 1 implementation report for the full
--   rationale.
--
--   Plan entitlement (recurring-special gating, seeded-special
--   grandfathering) is enforced in application code (src/lib/plans.ts),
--   never in RLS — identical posture to events, for the identical reason:
--   RLS decides *which venue's rows* a caller may touch, never *what kind*
--   of special they may create/change. See src/lib/plans.ts for the new
--   canUseRecurringDailySpecials() / canManageGrandfatheredRecurringDailySpecial()
--   / canCreateRecurringDailySpecialInSupportMode() helpers.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTION: array_has_duplicate_smallints
--
-- Postgres CHECK constraints cannot contain a subquery directly (e.g.
-- `ARRAY(SELECT DISTINCT unnest(...))` inline in a CHECK expression is
-- rejected), but a subquery INSIDE an IMMUTABLE SQL function body is fine —
-- this is the standard workaround, used here solely to let
-- daily_specials_days_of_week_no_duplicates_check (below) reject a
-- days_of_week array with repeated weekday values ("avoid duplicate weekday
-- values where reasonably possible" per the Phase 1 task brief). Pure,
-- IMMUTABLE, no table access — safe to use in a CHECK constraint and safe
-- to keep indefinitely; not specific to Daily Specials, so it's named
-- generically in case a future smallint[] column needs the same guard.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.array_has_duplicate_smallints(arr SMALLINT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT arr IS NOT NULL
    AND cardinality(arr) <> cardinality(ARRAY(SELECT DISTINCT unnest(arr)));
$$;

COMMENT ON FUNCTION public.array_has_duplicate_smallints IS
  'Returns TRUE if arr contains any repeated element. Used by CHECK '
  'constraints that cannot express this inline (Postgres disallows '
  'subqueries directly inside a CHECK expression). Pure/IMMUTABLE — safe '
  'for constraint use. Introduced for daily_specials.days_of_week; not '
  'specific to that table.';

-- EXECUTE must be granted to every role that can INSERT/UPDATE
-- daily_specials directly (anon, authenticated, service_role) — unlike a
-- SECURITY DEFINER RPC (migrations 085/088, where REVOKE-then-GRANT closes
-- an unwanted PUBLIC default), a CHECK constraint's function calls are
-- evaluated AS THE ROLE PERFORMING THE WRITE, not as the function's owner.
-- A role with no EXECUTE privilege on this function cannot INSERT/UPDATE
-- any row at all — including rows RLS would otherwise allow — because
-- Postgres cannot even evaluate the CHECK constraint on their behalf
-- ("permission denied for function ..."). This was caught empirically by
-- this task's own RLS validation pass (an authenticated venue owner's
-- otherwise-authorized UPDATE failed until this GRANT was added) — kept
-- here as a corrected first version rather than a follow-up migration,
-- since this file had not yet been committed. No REVOKE FROM PUBLIC is
-- needed: this function is pure/IMMUTABLE with no side effects and no
-- elevated privileges to protect, so leaving the default PUBLIC EXECUTE
-- grant in place (matching every other plain SQL/plpgsql helper in this
-- schema, e.g. update_updated_at()) is simplest and correct — the explicit
-- grants below are for documentation/consistency with this table's other
-- GRANT statements, not because the default would otherwise be wrong.
GRANT EXECUTE ON FUNCTION public.array_has_duplicate_smallints(SMALLINT[]) TO anon;
GRANT EXECUTE ON FUNCTION public.array_has_duplicate_smallints(SMALLINT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.array_has_duplicate_smallints(SMALLINT[]) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: daily_specials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_specials (
  -- ── Identity / ownership ────────────────────────────────────────────────
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_by_operator_id  UUID        REFERENCES public.operators(id) ON DELETE SET NULL,
  updated_by_operator_id  UUID        REFERENCES public.operators(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Content ──────────────────────────────────────────────────────────────
  -- No offer-items table by design — title/short_summary/description/
  -- conditions carry the entire offer (see migration header).
  title           TEXT NOT NULL,
  offer_type      TEXT NOT NULL,
  short_summary   TEXT,
  description     TEXT,
  conditions      TEXT,
  image_url       TEXT,

  -- ── Schedule ─────────────────────────────────────────────────────────────
  schedule_type           TEXT NOT NULL,
  one_time_date           DATE,
  days_of_week             SMALLINT[],
  recurrence_start_date    DATE,
  recurrence_end_date      DATE,

  -- ── Time ─────────────────────────────────────────────────────────────────
  time_mode   TEXT NOT NULL DEFAULT 'unspecified',
  start_time  TIME,
  end_mode    TEXT NOT NULL DEFAULT 'unspecified',
  end_time    TIME,

  -- ── State / provenance ───────────────────────────────────────────────────
  is_published        BOOLEAN     NOT NULL DEFAULT FALSE,
  is_seeded_special    BOOLEAN     NOT NULL DEFAULT FALSE,
  source_url           TEXT,
  last_verified_at      TIMESTAMPTZ
);

COMMENT ON TABLE public.daily_specials IS
  'Food/drink promotions on a defined schedule (e.g. "Wing Wednesday"), '
  'venue-owned, alongside Happy Hours (columns on venues) and Events '
  '(public.events). Separate content type — never stored in public.events. '
  'No offer-items child table (v1 product decision): the offer is carried '
  'entirely by title/short_summary/description/conditions. No slug/detail '
  'page — a future venue-detail page deep-links to this row via its own '
  '`id` (e.g. "#daily-special-<id>"). Phase 1 (data foundation) — no '
  'Operator Admin, consumer, or homepage UI reads/writes this table yet.';

COMMENT ON COLUMN public.daily_specials.venue_id IS
  'FK to venues.id. ON DELETE CASCADE — a Daily Special has no meaning '
  'without its venue, same rationale as events.venue_id.';

COMMENT ON COLUMN public.daily_specials.created_by_operator_id IS
  'Attribution only, NOT used for authorization (see events.created_by_operator_id '
  'precedent) — NULL for every seeded special. ON DELETE SET NULL: removing '
  'an operator account must not delete the venue''s specials.';

COMMENT ON COLUMN public.daily_specials.updated_by_operator_id IS
  'Attribution only for the most recent edit. NULL when the most recent '
  'write had no real operator (e.g. unclaimed-venue support-mode '
  'impersonation — see saveEventAction''s equivalent handling).';

COMMENT ON COLUMN public.daily_specials.offer_type IS
  'food | drink | food_drink. Constrained via CHECK (daily_specials_offer_type_check), '
  'not a Postgres enum — matches this project''s established convention '
  '(events.event_type, venues.source, claims.status, etc. all use TEXT + CHECK).';

COMMENT ON COLUMN public.daily_specials.short_summary IS
  'Short searchable summary, e.g. "$12 wings plus featured beer and cocktail '
  'specials." Nullable — flexible enough for a minimal seeded row.';

COMMENT ON COLUMN public.daily_specials.description IS
  'Longer free-text offer detail, e.g. "Wings $12. Race Rocks Amber $6." '
  'No pricing/discount normalization by design (v1 product decision) — '
  '"$12", "half price", "2 for 1", "market price" are all just text here.';

COMMENT ON COLUMN public.daily_specials.conditions IS
  'Free-text conditions/additional details, e.g. "Dine-in only. Beverage '
  'purchase required." Nullable.';

COMMENT ON COLUMN public.daily_specials.image_url IS
  'Optional single image. Phase 1 adds no upload path (no Storage bucket '
  'writes in this migration) — a later phase is expected to reuse the '
  '"venue-images" bucket + server-action upload pattern from '
  'src/app/admin/events/imageActions.ts, per the architecture investigation.';

COMMENT ON COLUMN public.daily_specials.schedule_type IS
  'one_time | weekly. Constrained via CHECK (daily_specials_schedule_type_check). '
  'Deliberately NOT just an is_recurring boolean, so a future schedule_type '
  '(e.g. monthly) can be added without a breaking rename — see '
  'daily_specials_schedule_fields_check for the full per-type field rules.';

COMMENT ON COLUMN public.daily_specials.one_time_date IS
  'Required and meaningful only when schedule_type = ''one_time''. Must be '
  'NULL for schedule_type = ''weekly'' — enforced by '
  'daily_specials_schedule_fields_check.';

COMMENT ON COLUMN public.daily_specials.days_of_week IS
  'Weekday set for schedule_type = ''weekly'' — 0=Sunday .. 6=Saturday '
  '(matches JavaScript Date.getDay(), used throughout the website''s '
  'existing date-filter code, e.g. dowFromIso() in EventSearchResults.tsx). '
  'Structured multi-value representation — deliberately NOT a single '
  'inferred day the way events.recurrence=''weekly'' infers its one day from '
  'first_date; supports "Monday-Friday" / "Saturday and Sunday" natively. '
  'Must be NULL for schedule_type = ''one_time'', and non-empty with no '
  'out-of-range or duplicate values for schedule_type = ''weekly'' — '
  'enforced by daily_specials_schedule_fields_check, '
  'daily_specials_days_of_week_range_check, and '
  'daily_specials_days_of_week_no_duplicates_check.';

COMMENT ON COLUMN public.daily_specials.recurrence_start_date IS
  'Optional validity start date for a weekly special (e.g. a seasonal '
  'special). NULL = already active / no explicit start boundary. Meaningless '
  'for schedule_type = ''one_time'' (must be NULL there — see '
  'daily_specials_schedule_fields_check).';

COMMENT ON COLUMN public.daily_specials.recurrence_end_date IS
  'Optional validity end date for a weekly special. NULL = continues '
  'indefinitely until edited/unpublished/deleted. When both '
  'recurrence_start_date and recurrence_end_date are set, end must not be '
  'earlier than start — enforced by daily_specials_recurrence_date_order_check.';

COMMENT ON COLUMN public.daily_specials.time_mode IS
  'unspecified | all_day | timed. Constrained via CHECK '
  '(daily_specials_time_mode_check). See migration header for the full '
  'worked-examples table.';

COMMENT ON COLUMN public.daily_specials.start_time IS
  'Real TIME value (venue-local wall-clock, no timezone conversion in '
  'Phase 1) — NOT a text label like events.start_time ("7:00 PM"). NULL '
  'unless time_mode = ''timed'' and a start time was actually specified.';

COMMENT ON COLUMN public.daily_specials.end_mode IS
  'unspecified | time | close. Constrained via CHECK '
  '(daily_specials_end_mode_check). ''close'' is semantic — it never stores '
  'or derives a clock time (see end_time''s own comment and the migration '
  'header). A future feature resolving ''close'' against the venue''s actual '
  'business hours reads venues.business_hours directly at that time; this '
  'column intentionally carries no snapshot of it.';

COMMENT ON COLUMN public.daily_specials.end_time IS
  'Real TIME value, meaningful ONLY when end_mode = ''time''. Must be NULL '
  'when end_mode is ''close'' or ''unspecified'' — enforced by '
  'daily_specials_end_mode_check. Never populated as a copy of the venue''s '
  'closing time when end_mode = ''close''.';

COMMENT ON COLUMN public.daily_specials.is_published IS
  'Draft/published state — same convention as venues.is_published / '
  'events.is_published.';

COMMENT ON COLUMN public.daily_specials.is_seeded_special IS
  'TRUE for platform-seeded Daily Specials. Semantics equivalent to '
  'events.is_seeded_event (migration 049) — drives the grandfathered-'
  'recurring-special entitlement exception in src/lib/plans.ts. Backfill is '
  'moot (this is a brand-new table with no pre-existing rows), so unlike '
  'migration 049 there is no UPDATE backfill step here — the column simply '
  'defaults FALSE, and any future seeding pass sets it TRUE explicitly.';

COMMENT ON COLUMN public.daily_specials.source_url IS
  'Optional provenance URL for seeded content (e.g. the venue''s menu page '
  'this special was sourced from). No events/venues equivalent exists. '
  'Storage only in Phase 1 — no staleness automation or review workflow is '
  'built by this migration.';

COMMENT ON COLUMN public.daily_specials.last_verified_at IS
  'Optional freshness timestamp for seeded content. Storage only in Phase '
  '1 — no automation reads or writes this column yet.';


-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

-- Closed value sets (CHECK, not enum — see offer_type's column comment).
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_offer_type_check
  CHECK (offer_type IN ('food', 'drink', 'food_drink'));

ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_schedule_type_check
  CHECK (schedule_type IN ('one_time', 'weekly'));

ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_time_mode_check
  CHECK (time_mode IN ('unspecified', 'all_day', 'timed'));

ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_end_mode_domain_check
  CHECK (end_mode IN ('unspecified', 'time', 'close'));

-- Per-schedule-type field shape. See migration header "SCHEDULE MODEL" for
-- the plain-English rules this encodes.
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_schedule_fields_check
  CHECK (
    (
      schedule_type = 'one_time'
      AND one_time_date IS NOT NULL
      AND days_of_week IS NULL
      AND recurrence_start_date IS NULL
      AND recurrence_end_date IS NULL
    )
    OR (
      schedule_type = 'weekly'
      AND one_time_date IS NULL
      AND days_of_week IS NOT NULL
      -- cardinality(), not array_length(days_of_week, 1): array_length()
      -- returns NULL (not 0) for an empty array, and a CHECK expression
      -- that evaluates to NULL is ACCEPTED by Postgres (not rejected) —
      -- that would silently let days_of_week = '{}' through. cardinality()
      -- correctly returns 0 for an empty array, so this comparison
      -- deterministically evaluates to FALSE and the row is rejected.
      AND cardinality(days_of_week) >= 1
    )
  );

-- Weekday value domain: every element must be 0-6. `<@` (contained by) is
-- both the range check and reads naturally as "days_of_week is a subset of
-- the 7 valid weekdays."
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_days_of_week_range_check
  CHECK (
    days_of_week IS NULL
    OR days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]
  );

-- No duplicate weekday values (e.g. [3, 3]) — see
-- array_has_duplicate_smallints()'s own comment for why this needs a helper
-- function rather than an inline CHECK expression.
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_days_of_week_no_duplicates_check
  CHECK (
    days_of_week IS NULL
    OR NOT public.array_has_duplicate_smallints(days_of_week)
  );

-- Optional recurrence validity window ordering.
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_recurrence_date_order_check
  CHECK (
    recurrence_start_date IS NULL
    OR recurrence_end_date IS NULL
    OR recurrence_end_date >= recurrence_start_date
  );

-- end_mode <-> end_time consistency (independent of time_mode — this rule
-- holds regardless of whether the row is all_day/unspecified/timed).
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_end_mode_check
  CHECK (
    (end_mode = 'time' AND end_time IS NOT NULL)
    OR (end_mode = 'close' AND end_time IS NULL)
    OR (end_mode = 'unspecified' AND end_time IS NULL)
  );

-- time_mode IN ('all_day', 'unspecified') carries no time information at
-- all: start_time must be NULL and end_mode must be 'unspecified' (which,
-- via daily_specials_end_mode_check above, already forces end_time NULL
-- too).
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_time_mode_check_no_time_check
  CHECK (
    time_mode NOT IN ('all_day', 'unspecified')
    OR (start_time IS NULL AND end_mode = 'unspecified')
  );

-- time_mode = 'timed' must carry at least one meaningful time boundary —
-- rejects a "timed" row with no start_time and no end (end_mode still
-- 'unspecified'), which would otherwise be indistinguishable from
-- time_mode = 'unspecified' but harder to reason about.
ALTER TABLE public.daily_specials
  ADD CONSTRAINT daily_specials_timed_boundary_check
  CHECK (
    time_mode <> 'timed'
    OR (start_time IS NOT NULL OR end_mode IN ('time', 'close'))
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- Reuses update_updated_at() from 001_initial_schema.sql, same as every
-- other timestamped table in this project.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER daily_specials_updated_at
  BEFORE UPDATE ON public.daily_specials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
--
-- Justified against the Phase 1 core data-access/occurrence helpers this
-- migration ships alongside (src/lib/data/dailySpecials.ts,
-- src/lib/dailySpecialSchedule.ts) plus the anticipated Phase 2+ consumer
-- query shapes named in the architecture investigation — not speculative.
-- ─────────────────────────────────────────────────────────────────────────────

-- Every per-venue query (Operator Admin's "all of my specials", including
-- drafts; a future venue-detail page's "this venue's specials") filters by
-- venue_id first. Unfiltered (not partial on is_published) because Operator
-- Admin needs drafts too.
CREATE INDEX IF NOT EXISTS daily_specials_venue_id_idx
  ON public.daily_specials (venue_id);

-- Mirrors the exact precedent of events_event_type_idx
-- (046_event_type.sql: `ON events (event_type) WHERE is_published = TRUE`).
-- Supports a future consumer/homepage query splitting published rows by
-- schedule_type (e.g. "published weekly specials" for Today's Specials
-- eligibility, vs. "published one-time specials" for date-based listing).
CREATE INDEX IF NOT EXISTS daily_specials_schedule_type_idx
  ON public.daily_specials (schedule_type)
  WHERE is_published = TRUE;

-- Supports one-time-date lookups (occursOnDate / isOneTimeSpecialExpired
-- callers) restricted to the rows that are actually eligible for either
-- query — draft rows and weekly rows never participate in one-time date
-- matching.
CREATE INDEX IF NOT EXISTS daily_specials_one_time_date_idx
  ON public.daily_specials (one_time_date)
  WHERE schedule_type = 'one_time' AND is_published = TRUE;

-- GIN supports `days_of_week @> ARRAY[n]`-style weekday-containment
-- queries — the query shape the future Today's Specials rail and Daily
-- Specials search page will use (per the architecture investigation's WHEN
-- filter). Partial for the same reason as the two indexes above: only
-- published weekly rows ever participate in this query.
CREATE INDEX IF NOT EXISTS daily_specials_days_of_week_gin_idx
  ON public.daily_specials USING GIN (days_of_week)
  WHERE schedule_type = 'weekly' AND is_published = TRUE;

-- Deliberately NOT indexed in Phase 1: recurrence_start_date /
-- recurrence_end_date. Every Phase 1 helper that reads these does so
-- per-row (already narrowed to one venue's small row set, or one already-
-- fetched candidate list) — there is no market-wide "which specials are
-- currently within their validity window" query yet (that is Phase 2+
-- consumer-search / homepage-rail work, out of scope here). Add a
-- (recurrence_start_date, recurrence_end_date) index if/when that query
-- ships and an EXPLAIN shows it's needed, rather than speculatively now.


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--
-- See migration header "SECURITY (RLS)" for the full rationale, including
-- why this deliberately scopes ALL FOUR policies to venue ownership rather
-- than reusing events' more permissive SELECT/INSERT shape verbatim.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.daily_specials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_specials: read for own venue"
  ON public.daily_specials
  FOR SELECT
  TO authenticated
  USING (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "daily_specials: insert for own venue"
  ON public.daily_specials
  FOR INSERT
  TO authenticated
  WITH CHECK (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "daily_specials: update for own venue"
  ON public.daily_specials
  FOR UPDATE
  TO authenticated
  USING (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "daily_specials: delete for own venue"
  ON public.daily_specials
  FOR DELETE
  TO authenticated
  USING (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );

-- No anon policies — daily_specials has no public intake form (unlike
-- venue_suggestions/operator_submissions). Every consumer-facing read goes
-- through createAdminClient() (service-role, bypasses RLS), matching every
-- other consumer read path in this codebase (getPublishedEventsForWebsite,
-- getPublishedVenuesForConsumer, etc.).


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (required for every new public-schema table — see CLAUDE.md and
-- migration 039_security_hardening.sql)
-- ─────────────────────────────────────────────────────────────────────────────

-- No anon grant — no public-facing intake form for this table.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_specials TO authenticated;

GRANT ALL ON public.daily_specials TO service_role;
