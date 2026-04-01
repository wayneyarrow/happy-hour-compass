-- =============================================================================
-- Happy Hour Compass — Venue Source Attribution + Intake Schema Foundation
-- Migration: 013_venue_source_attribution.sql
--
-- PURPOSE:
--   Establishes venue source attribution and creates two new intake tables
--   to support upcoming venue suggestion and operator submission workflows.
--
-- WHAT THIS MIGRATION DOES:
--   1. Creates venue_suggestions — consumer-submitted venue suggestions.
--   2. Creates operator_submissions — pre-auth operator interest intake.
--   3. Adds venues.source TEXT with CHECK constraint (4 allowed values).
--   4. Backfills all existing venues rows to source = 'seed'.
--   5. Adds venues.source_suggestion_id FK → venue_suggestions(id).
--   6. Adds venues.source_submission_id  FK → operator_submissions(id).
--   7. Adds indexes on venues.source, venue_suggestions.status,
--      operator_submissions.status, operator_submissions.place_id.
--   8. Wires update_updated_at() triggers to both new tables.
--   9. Enables RLS on both new tables with minimal safe V1 policies.
--
-- ATTRIBUTION RULE:
--   source = the origin of the venue record, NOT who performed the final
--   conversion action.  A consumer suggestion converted internally still
--   carries source = 'consumer_suggestion', not 'internal'.
--
-- ALLOWED source VALUES:
--   'seed'                — pipeline-seeded or historically imported venue
--   'operator_submission' — created from an operator_submissions intake record
--   'consumer_suggestion' — created from a venue_suggestions intake record
--   'internal'            — created directly by internal team with no upstream intake
--
-- FK DELETE STRATEGY:
--   source_suggestion_id and source_submission_id use ON DELETE SET NULL.
--   Deleting an intake record will NOT cascade-delete the linked live venue.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: venue_suggestions
--
--   Consumer-submitted suggestions for venues not yet listed in the directory.
--   Intake only — no auth required at submission time.
--   Internal review is performed via service-role in a secure server context.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_suggestions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core suggestion data
  name          TEXT        NOT NULL,
  city          TEXT        NOT NULL,
  notes         TEXT,                     -- optional extra context from the submitter

  -- Timestamps
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Review state
  -- status values enforced by CHECK constraint below
  status        TEXT        NOT NULL DEFAULT 'new'
);

COMMENT ON TABLE public.venue_suggestions IS
  'Consumer-submitted suggestions for venues not yet in the directory. '
  'Reviewed internally; converted suggestions produce a venue row with '
  'source = ''consumer_suggestion'' and source_suggestion_id pointing here.';

COMMENT ON COLUMN public.venue_suggestions.status IS
  'Review status. Constrained to: new | reviewed | converted | rejected.';

ALTER TABLE public.venue_suggestions
  ADD CONSTRAINT venue_suggestions_status_check
  CHECK (status IN ('new', 'reviewed', 'converted', 'rejected'));


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: operator_submissions
--
--   Pre-auth intake for operators who want to add or claim a venue.
--   Collected before an operator account exists; reviewed internally before
--   an account is provisioned.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_submissions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Submitter identity
  operator_name       TEXT        NOT NULL,
  email               TEXT        NOT NULL,

  -- Venue being submitted
  venue_name          TEXT        NOT NULL,
  place_id            TEXT,                 -- Google Places ID; nullable at submission time

  -- Timestamps
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Review state
  -- status values enforced by CHECK constraint below
  status              TEXT        NOT NULL DEFAULT 'new'
);

COMMENT ON TABLE public.operator_submissions IS
  'Pre-auth operator interest intake. Submitted before an operator account exists. '
  'Approved submissions produce an operator account + venue row with '
  'source = ''operator_submission'' and source_submission_id pointing here.';

COMMENT ON COLUMN public.operator_submissions.place_id IS
  'Google Places ID for the submitted venue. Nullable at intake time; '
  'may be resolved during internal review.';

COMMENT ON COLUMN public.operator_submissions.status IS
  'Review status. Constrained to: new | approved | rejected | converted_to_operator.';

ALTER TABLE public.operator_submissions
  ADD CONSTRAINT operator_submissions_status_check
  CHECK (status IN ('new', 'approved', 'rejected', 'converted_to_operator'));


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGERS: auto-update updated_at on both new tables
--
-- Reuses the update_updated_at() function defined in 001_initial_schema.sql.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER venue_suggestions_updated_at
  BEFORE UPDATE ON public.venue_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER operator_submissions_updated_at
  BEFORE UPDATE ON public.operator_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY: venue_suggestions
--
-- INSERT open to anon + authenticated (public suggestion form, no login gate).
-- SELECT / UPDATE / DELETE: no permissive policy → denied to all non-service-role.
-- Internal review is performed via service-role in a secure server context.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_suggestions: public insert" ON public.venue_suggestions;
CREATE POLICY "venue_suggestions: public insert"
  ON public.venue_suggestions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY: operator_submissions
--
-- INSERT open to anon + authenticated (pre-auth form, no account required).
-- SELECT / UPDATE / DELETE: no permissive policy → denied to all non-service-role.
-- Internal review is performed via service-role in a secure server context.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operator_submissions: public insert" ON public.operator_submissions;
CREATE POLICY "operator_submissions: public insert"
  ON public.operator_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);


-- ─────────────────────────────────────────────────────────────────────────────
-- VENUES TABLE: add source attribution columns
--
-- source                — required, constrained to 4 values (see CHECK below)
-- source_suggestion_id  — nullable FK → venue_suggestions(id), ON DELETE SET NULL
-- source_submission_id  — nullable FK → operator_submissions(id), ON DELETE SET NULL
--
-- The FK columns are added AFTER the intake tables exist so the references are
-- valid.  Both FKs use ON DELETE SET NULL: removing an intake record will not
-- cascade-delete the live venue row.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed',
  ADD COLUMN IF NOT EXISTS source_suggestion_id UUID,
  ADD COLUMN IF NOT EXISTS source_submission_id  UUID;

COMMENT ON COLUMN public.venues.source IS
  'Origin of this venue record. Allowed values: seed | operator_submission | '
  'consumer_suggestion | internal. Represents the origin, not the converter.';

COMMENT ON COLUMN public.venues.source_suggestion_id IS
  'FK to venue_suggestions.id when this venue was created from a consumer suggestion. '
  'NULL for all other sources. SET NULL if the suggestion row is deleted.';

COMMENT ON COLUMN public.venues.source_submission_id IS
  'FK to operator_submissions.id when this venue was created from an operator submission. '
  'NULL for all other sources. SET NULL if the submission row is deleted.';

-- CHECK constraint on source — consistent with status constraint style in this project
ALTER TABLE public.venues
  ADD CONSTRAINT venues_source_check
  CHECK (source IN ('seed', 'operator_submission', 'consumer_suggestion', 'internal'));

-- FK: source_suggestion_id → venue_suggestions(id), conservative delete behavior
ALTER TABLE public.venues
  ADD CONSTRAINT venues_source_suggestion_id_fk
  FOREIGN KEY (source_suggestion_id)
  REFERENCES public.venue_suggestions(id)
  ON DELETE SET NULL;

-- FK: source_submission_id → operator_submissions(id), conservative delete behavior
ALTER TABLE public.venues
  ADD CONSTRAINT venues_source_submission_id_fk
  FOREIGN KEY (source_submission_id)
  REFERENCES public.operator_submissions(id)
  ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL: mark all pre-existing venues as source = 'seed'
--
-- The DEFAULT 'seed' on the column covers this for the ADD COLUMN statement,
-- but an explicit UPDATE makes the backfill intention clear and ensures
-- correctness if any row somehow has a NULL (e.g. from a deferred constraint
-- evaluation order).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.venues
  SET source = 'seed'
  WHERE source IS NULL OR source = 'seed';


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- venues.source — supports filtering the venue list by origin in CP review
CREATE INDEX IF NOT EXISTS venues_source_idx
  ON public.venues (source);

-- venue_suggestions.status — supports the review queue ordered by arrival time
CREATE INDEX IF NOT EXISTS venue_suggestions_status_submitted_at_idx
  ON public.venue_suggestions (status, submitted_at DESC);

-- operator_submissions.status — supports the review queue ordered by arrival time
CREATE INDEX IF NOT EXISTS operator_submissions_status_submitted_at_idx
  ON public.operator_submissions (status, submitted_at DESC);

-- operator_submissions.place_id — supports deduplication lookup during review
-- Partial index: only rows where place_id is not null are relevant for lookup
CREATE INDEX IF NOT EXISTS operator_submissions_place_id_idx
  ON public.operator_submissions (place_id)
  WHERE place_id IS NOT NULL;
