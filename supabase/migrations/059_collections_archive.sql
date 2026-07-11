-- =============================================================================
-- Migration 059: Collections — Archive Lifecycle
--
-- Adds a soft "archive" lifecycle to public.collections, kept deliberately
-- separate from the existing editorial `status` column (draft | published —
-- migration 058). Editorial status answers "is this Collection's curation
-- ready to show publicly." Archiving answers a different question entirely —
-- "should this Collection still show up as an active, reusable editorial
-- asset in Control Panel workflows" — and a Collection can be Published (or
-- Draft) independently of whether it's archived. Overloading `status` with a
-- third value would conflate these two concerns and break every existing
-- `status IN ('draft', 'published')` check (createCollectionAction,
-- updateCollectionAction, the collections_status_check CHECK constraint
-- itself) for no benefit — a genuinely separate nullable-timestamp column is
-- the smallest safe adjustment.
--
-- Single-column design (archived_at TIMESTAMPTZ, nullable) rather than a
-- separate archived_at + is_archived boolean pair: one nullable timestamp is
-- both the boolean flag (NULL = active, NOT NULL = archived) and the "when"
-- audit value, with no risk of the two ever drifting out of sync. Restoring
-- a Collection is simply `archived_at = NULL`.
--
-- This migration is schema + index only — no application code, no query
-- layer changes, no admin UI. See operator-admin/src/lib/data/collections.ts
-- and control-panel/collections/actions.ts for the archive/restore data
-- layer and server actions that consume this column, and
-- control-panel/collections/CollectionsTable.tsx / CollectionForm.tsx for
-- the admin UI (Active/Archived/All filter, Archive/Restore actions).
--
-- No GRANT changes needed: public.collections already has its full GRANT
-- block from migration 058 (service_role only, internal editorial asset) —
-- adding a column to an existing table does not require re-granting.
-- =============================================================================

ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.collections.archived_at IS
  'Soft-archive lifecycle marker, independent of the editorial status '
  'column (draft | published). NULL = active (the default; included in '
  'normal Control Panel lists and eligible for Homepage Section '
  'assignment). NOT NULL = archived: excluded from the default Collections '
  'list, blocked from new Homepage Section assignment '
  '(validateSectionCollectionAssignment in homepages.ts), but the row and '
  'all its membership/overrides remain fully intact in the database and '
  'can be restored (archived_at set back to NULL) at any time. Archiving '
  'is blocked at the application layer while the Collection is assigned to '
  'any Homepage Section (see archiveCollection in collections.ts) — there '
  'is no DB-level constraint for this because archiving is an UPDATE, not '
  'a DELETE, so the existing homepage_sections_collection_type_match '
  '(migration 058) ON DELETE RESTRICT backstop does not apply here.';

-- Partial index — mirrors the "only index the sparse/interesting value"
-- philosophy already used for collections.algorithm_key (migration 058):
-- most rows will have archived_at IS NULL (active), so indexing only the
-- archived subset keeps the index small while still making "list archived
-- Collections" and "is this specific Collection archived" fast.
CREATE INDEX IF NOT EXISTS collections_archived_at_idx
  ON public.collections (archived_at)
  WHERE archived_at IS NOT NULL;
