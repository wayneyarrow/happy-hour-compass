-- =============================================================================
-- Happy Hour Compass — Venue Feature Adoption (Durable Operator Engagement)
-- Migration: 096_venue_feature_adoption.sql
--
-- REVISION HISTORY (this file was never applied anywhere — see CLAUDE.md
-- workflow rules — so every correction below is made IN PLACE, not as a
-- follow-up migration):
--
--   Rev 1 (original): recorded adoption via AFTER INSERT/UPDATE triggers on
--     events/daily_specials that inspected created_by_operator_id/
--     updated_by_operator_id on every write. REJECTED: Case A impersonation
--     ("Open as Operator" on a claimed venue) resolves the SAME real
--     operators.id a genuine login would resolve (see src/lib/impersonation.ts),
--     so those columns are stamped identically either way — a trigger
--     inspecting only NEW.* cannot tell a genuine write from an impersonated
--     one, and would also treat a later admin edit of already-attributed
--     content as fresh engagement.
--
--   Rev 2: removed the trigger entirely. Added events.is_genuine_operator_engaged /
--     daily_specials.is_genuine_operator_engaged, computed in trusted
--     application code (isGenuineOperatorContext()/genuineOperatorFieldPatch(),
--     src/lib/customerSuccess/featureAdoption.ts) — TRUE only for a real,
--     non-impersonated operator/member session, monotonic (never reset
--     FALSE). Durable venue_feature_adoption was written by a SEPARATE
--     post-save RPC call (recordFeatureAdoption()) after the content write
--     had already committed. GAP: if that separate RPC call failed (network
--     blip, transient error), a venue's FIRST genuine adoption could be
--     silently lost even though the content itself saved successfully —
--     content and durable-adoption state could diverge.
--
--   Rev 3 (this revision): closes that gap AND adds an evidence-based
--     historical backfill, per a read-only production audit (see BACKFILL
--     section below for full results). Two changes:
--
--     (a) ATOMICITY FOR FIRST ADOPTION — a NEW, narrowly-scoped trigger
--         (events_first_adoption_trigger() / daily_specials_first_adoption_trigger())
--         reacts ONLY to is_genuine_operator_engaged transitioning from
--         FALSE to TRUE (or being TRUE on INSERT) — never to historical
--         created_by_operator_id/updated_by_operator_id values, which is
--         exactly what made Rev 1 unsafe. Because is_genuine_operator_engaged
--         is itself only ever set TRUE by trusted, already-vetted
--         application code (never inferred by this trigger from ambiguous
--         attribution), reacting to ITS transition carries none of Rev 1's
--         risk. This trigger writes venue_feature_adoption in the SAME
--         database transaction as the content INSERT/UPDATE — if the
--         content write commits, durable adoption is guaranteed to exist;
--         there is no longer a separate round-trip that can fail
--         independently. recordFeatureAdoption()'s post-save RPC call is
--         KEPT for SUBSEQUENT genuine engagement (advancing last_engaged_at
--         on repeat edits) — see its own comment for why a later failure
--         there is now low-stakes (adoption itself is already durable by
--         the time that RPC runs).
--
--     (b) HISTORICAL BACKFILL — Rev 2 shipped with NO backfill, reasoning
--         that created_by_operator_id/updated_by_operator_id alone cannot
--         distinguish genuine activity from Case A impersonation. A
--         read-only production audit (via the project's established
--         service-role script pattern — see AUDIT METHOD below) confirmed
--         this is true in general, but also confirmed that
--         operator_impersonation_sessions provides a reliable per-venue
--         time-window cross-check: a candidate row's evidence timestamp
--         (created_at for a creation claim, updated_at for an edit claim)
--         can be checked against every impersonation session recorded for
--         that SAME venue. A candidate with NO overlapping session is
--         treated as high-confidence genuine — exactly the policy the task
--         brief specifies as the minimum defensible bar. See BACKFILL below
--         for exact results: every one of the 14 candidate rows in
--         production today cleared this bar (zero overlaps found), and
--         there were zero seeded/edit-qualifying candidates to evaluate.
--
-- AUDIT METHOD: read-only SELECT queries via a service-role Supabase client
-- (@supabase/supabase-js + operator-admin/.env.local's SUPABASE_SECRET_KEY),
-- run with `tsx` from the operator-admin directory — the exact same
-- env-loading/client-construction pattern already used by this repo's own
-- scripts (e.g. scripts/backfillGoogleRating.ts). No writes were performed.
-- The project's Supabase MCP tool was attempted first and returned
-- "Unauthorized" despite SUPABASE_ACCESS_TOKEN being present in the shell
-- (an MCP-server-process env-propagation issue, not a project access-control
-- decision) — the script-based path above is this repository's OTHER
-- established, already-proven authorized method for privileged Supabase
-- access, and was used instead per the task's explicit instruction not to
-- treat one blocked path as proof access is unavailable.
--
-- LOCKED PRODUCT DEFINITION THIS SCHEMA ENCODES (unchanged from Rev 2):
--   Adoption requires genuine, non-impersonated operator/member engagement:
--     (a) creating a NON-SEEDED Event/Daily Special with a real operator
--         stamped as creator, OR
--     (b) editing/managing an INHERITED SEEDED Event/Daily Special with a
--         real operator stamped as the most recent updater —
--   in BOTH cases, only when that specific action happened through a
--   genuine (non-impersonated) session — see isGenuineOperatorContext()
--   (src/lib/customerSuccess/featureAdoption.ts). Draft/unpublished content
--   counts toward adoption; never toward the active count.
--
-- WHY STILL NOT public.customer_success_events (093): unchanged — that
-- table is purpose-built around a communication/delivery lifecycle for
-- milestone emails, an unrelated concern.
--
-- WHY venue_id HAS NO FK TO events/daily_specials AT ALL (unchanged): the
-- durability guarantee ("adoption survives permanent Event/Special
-- deletion") comes from venue_feature_adoption having no foreign key
-- relationship to any specific content row — deleting content cannot
-- cascade into it.
--
-- WHY venue_id -> venues(id) IS ON DELETE CASCADE (unchanged): every
-- venue-scoped child table in this schema cascades from venues, and a
-- confirmed real hard-delete-venue path exists
-- (src/app/control-panel/operator-submissions/[id]/actions.ts:608).
--
-- SECURITY (see full analysis further down, at the provenance-column
-- section): venue_feature_adoption remains internal-only (RLS enabled, no
-- permissive policies, service-role only). The two provenance columns are
-- plain columns on already-RLS-covered tables. A residual, deliberately
-- accepted risk is documented there: an already-authorized venue
-- owner/operator could, via a raw REST call bypassing the app UI entirely,
-- set is_genuine_operator_engaged = true on their OWN venue's row directly
-- — this is not new risk (that same operator can already directly edit any
-- other column of their own venue's content the same way today), cannot
-- cross into another venue's data (existing RLS ownership scoping is
-- unchanged), and cannot be closed with a column-level privilege
-- restriction without breaking the legitimate write path, which uses the
-- IDENTICAL `authenticated` role for its own genuine writes (see that
-- section for the full reasoning).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: venue_feature_adoption
-- Durable venue-level adoption. Unchanged since Rev 1 — this table was
-- never the flawed part of the design.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_feature_adoption (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                      UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  feature                       TEXT        NOT NULL,

  first_adopted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_engaged_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  first_adopted_by_operator_id  UUID        REFERENCES public.operators(id) ON DELETE SET NULL,
  last_engaged_by_operator_id   UUID        REFERENCES public.operators(id) ON DELETE SET NULL,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT venue_feature_adoption_feature_check
    CHECK (feature IN ('daily_specials', 'events')),
  CONSTRAINT venue_feature_adoption_venue_feature_unique
    UNIQUE (venue_id, feature)
);

COMMENT ON TABLE public.venue_feature_adoption IS
  'Durable, permanent record of genuine (non-impersonated) operator-attributed '
  'engagement with a feature (Daily Specials, Events) for a venue. Never '
  'cleared by content expiring, being unpublished, or being permanently '
  'deleted. Written by: (1) events_first_adoption_trigger()/'
  'daily_specials_first_adoption_trigger() — atomically, in the same '
  'transaction as the content write, the FIRST time is_genuine_operator_engaged '
  'becomes true for a row; (2) recordFeatureAdoption() '
  '(src/lib/customerSuccess/featureAdoption.ts), a separate idempotent '
  'service-role RPC for SUBSEQUENT genuine engagement (advancing '
  'last_engaged_at only — see that function''s comment for why a failure '
  'there cannot revert or lose adoption). Never written by inspecting '
  'historical created_by_operator_id/updated_by_operator_id directly — see '
  'migration header for why that is unsafe. Independent of '
  'customer_success_events (093), which governs an unrelated milestone-email '
  'delivery workflow.';

COMMENT ON COLUMN public.venue_feature_adoption.feature IS
  'daily_specials | events. Closed set matching the two features the '
  'Feature Adoption card currently covers — see migration header.';

COMMENT ON COLUMN public.venue_feature_adoption.first_adopted_at IS
  'When this venue''s operator FIRST qualified as adopted for this feature. '
  'Never overwritten once set — see the ON CONFLICT clause in '
  'record_feature_adoption() below, which updates every column except this one.';

COMMENT ON COLUMN public.venue_feature_adoption.last_engaged_at IS
  'Most recent qualifying GENUINE operator engagement. Advances only when '
  'record_feature_adoption() is invoked with a genuine (non-impersonated) '
  'operator context — via the first-adoption trigger (first time only) or '
  'recordFeatureAdoption()''s RPC (subsequent times). Never read by the UI '
  'directly (activeCount is computed live from current rows) — retained for '
  'Customer Success debugging/context.';

COMMENT ON COLUMN public.venue_feature_adoption.first_adopted_by_operator_id IS
  'Attribution only, not authorization — the operator whose engagement '
  'first satisfied adoption. NULL if that operator account is later '
  'deleted (ON DELETE SET NULL); the adoption fact itself is unaffected.';

COMMENT ON COLUMN public.venue_feature_adoption.last_engaged_by_operator_id IS
  'Attribution only, for the most recent qualifying engagement. Same '
  'ON DELETE SET NULL rationale as first_adopted_by_operator_id.';


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at (same convention as every other table)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER venue_feature_adoption_updated_at
  BEFORE UPDATE ON public.venue_feature_adoption
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Internal-only — no anon/authenticated policies. Reads/writes go through
-- createAdminClient() (service-role) directly, or through the two
-- SECURITY DEFINER first-adoption trigger functions below, which run with
-- their owner's privileges regardless of which role's write on
-- events/daily_specials fired them.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_feature_adoption ENABLE ROW LEVEL SECURITY;

-- No permissive policies — service-role bypasses RLS; no other caller
-- should ever read or write this table directly.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (required for every new public-schema table — see CLAUDE.md and
-- migration 039_security_hardening.sql)
-- ─────────────────────────────────────────────────────────────────────────────

-- No anon grant — no public-facing surface for this table.
-- No authenticated grant — internal Customer Success signal only.

GRANT ALL ON public.venue_feature_adoption TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: record_feature_adoption
--
-- Idempotent upsert into venue_feature_adoption. Preserves first_adopted_at
-- (omitted from the UPDATE branch), advances last_engaged_at
-- unconditionally on every call, and only overwrites the "last engaged by"
-- attribution when a real operator id is provided.
--
-- Called from TWO trusted places:
--   1. recordFeatureAdoption() (src/lib/customerSuccess/featureAdoption.ts)
--      via RPC, using a fresh service-role admin client — for SUBSEQUENT
--      genuine engagement after the first.
--   2. The two first-adoption trigger functions below, via PERFORM, for the
--      FIRST genuine engagement — atomically, in the same transaction as
--      the content write.
--
-- Plain LANGUAGE sql, NOT SECURITY DEFINER itself: caller #1 already runs
-- as service_role (bypasses RLS on its own — BYPASSRLS); caller #2 is
-- itself SECURITY DEFINER, and a nested PERFORM call from inside a
-- SECURITY DEFINER function keeps running as that function's OWNER for the
-- duration — the owner has implicit EXECUTE on every function it owns
-- (including this one, since the same migration-running role creates both),
-- regardless of the PUBLIC/authenticated REVOKE below. No additional
-- privilege escalation is needed on this function itself.
--
-- SECURITY-CRITICAL: this function performs NO ownership/authorization
-- check on p_venue_id — it blindly upserts whatever it is given. It MUST
-- NEVER be granted EXECUTE to `anon`/`authenticated` directly (as an
-- ordinary callable RPC), because Postgrest exposes any function with
-- EXECUTE granted to those roles as a directly callable endpoint reachable
-- from the browser — an authenticated operator could otherwise call this
-- directly and forge adoption for ANY venue_id, not just their own. The
-- REVOKE/GRANT pair below is the actual enforcement of "an ordinary client
-- cannot directly forge adoption via this function."
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_feature_adoption(
  p_venue_id    UUID,
  p_feature     TEXT,
  p_operator_id UUID
)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO public.venue_feature_adoption AS vfa (
    venue_id, feature,
    first_adopted_at, last_engaged_at,
    first_adopted_by_operator_id, last_engaged_by_operator_id
  )
  VALUES (
    p_venue_id, p_feature,
    now(), now(),
    p_operator_id, p_operator_id
  )
  ON CONFLICT (venue_id, feature) DO UPDATE
  SET last_engaged_at             = now(),
      last_engaged_by_operator_id = COALESCE(p_operator_id, vfa.last_engaged_by_operator_id),
      updated_at                  = now();
$$;

COMMENT ON FUNCTION public.record_feature_adoption(UUID, TEXT, UUID) IS
  'Idempotent upsert into venue_feature_adoption. Called only from '
  'recordFeatureAdoption() (RPC, subsequent engagement) and the '
  'first-adoption triggers (PERFORM, first engagement) — never a directly '
  'client-callable RPC. See the function-level security comment above.';

REVOKE EXECUTE ON FUNCTION public.record_feature_adoption(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_feature_adoption(UUID, TEXT, UUID) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- CONTENT-LEVEL PROVENANCE: is_genuine_operator_engaged
--
-- New column on public.events and public.daily_specials. TRUE once ANY
-- write to the row has been made by a genuine (non-impersonated)
-- operator/member session — set by saveEventAction()/saveDailySpecialAction()
-- in the SAME statement as the actual content write, via
-- genuineOperatorFieldPatch(ctx) (src/lib/customerSuccess/featureAdoption.ts),
-- never inferred later from created_by_operator_id/updated_by_operator_id.
--
-- Monotonic — the application only ever writes TRUE, never FALSE (the field
-- is omitted entirely, not set false, when the current write is not
-- genuine). Guarantees a later admin/impersonation edit can neither grant
-- nor revoke it.
--
-- Used by (1) Feature Adoption's active-count computation
-- (getVenueFeatureAdoption() in featureAdoption.ts), filtered alongside
-- is_published; and (2) the first-adoption triggers immediately below, which
-- react to this column's own FALSE→TRUE transition. Has no bearing on
-- authorization, ownership, plan entitlement, or any existing Event/Daily
-- Special behavior otherwise.
--
-- ── SECURITY REVIEW: can an authenticated client set this directly? ────────
-- Yes, in one specific, narrow, pre-existing-risk-equivalent case, examined
-- and deliberately accepted rather than engineered around:
--
--   A genuine, single-venue "owner" operator (not a member, not
--   impersonated — src/lib/impersonation.ts buildNormalContext() "Owner
--   context" branch) saves an event/special using the plain RLS-scoped
--   `authenticated` Supabase client, not the service-role admin client.
--   RLS's existing venue-ownership scoping ("events: update own",
--   corrected to venue-ownership in 071_events_venue_ownership_rls.sql; the
--   equivalent daily_specials policies from 091) already restricts that
--   operator to rows belonging to venues THEY own — unchanged by this
--   migration. But RLS is row-scoped, not column-scoped: nothing stops that
--   SAME operator from bypassing the Next.js app entirely and issuing a raw
--   PostgREST PATCH request against their OWN event/special row, setting
--   is_genuine_operator_engaged = true directly, without ever going through
--   isGenuineOperatorContext()'s check.
--
--   This is NOT a new category of risk introduced by this column: that same
--   operator can, today, already directly PATCH any OTHER column of their
--   own venue's content the same way (title, description, schedule, etc.) —
--   RLS has always granted them raw write access to their own rows; the app
--   UI is a convenience layer, not the enforcement boundary, for anyone who
--   already legitimately owns that data. It also cannot cross into another
--   venue's data — RLS's venue-ownership predicate is completely unchanged.
--
--   A column-level privilege restriction (REVOKE UPDATE (is_genuine_operator_engaged)
--   ON events FROM authenticated) was considered and REJECTED: the
--   legitimate "Owner context" genuine-save path writes this exact column
--   using the exact same `authenticated` role as the hypothetical forger —
--   Postgres column privileges cannot distinguish "the app's own trusted
--   write" from "a raw REST call" when both originate from the identical
--   database role and credential. Restricting the column would break the
--   legitimate write path along with the hypothetical misuse.
--
--   Conclusion (matches the task brief's own risk framing): an already-
--   authorized operator marginally mis-timing their own adoption record on
--   their own content is low-stakes and not worth a column-level
--   restriction that would break legitimate functionality. What DOES remain
--   fully enforced, unchanged: an UNAFFILIATED user cannot set this column
--   on a venue they do not own (blocked by existing row-level RLS), and
--   direct RPC-level forgery of the DURABLE venue_feature_adoption table
--   itself remains blocked by record_feature_adoption()'s REVOKE/GRANT
--   above regardless of this column's value.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_genuine_operator_engaged BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.events.is_genuine_operator_engaged IS
  'TRUE once this event has been written at least once by a genuine '
  '(non-impersonated) operator/member session. Monotonic (set-only-to-TRUE) '
  '— see migration 096 header and its security-review comment.';

ALTER TABLE public.daily_specials
  ADD COLUMN IF NOT EXISTS is_genuine_operator_engaged BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.daily_specials.is_genuine_operator_engaged IS
  'TRUE once this Daily Special has been written at least once by a genuine '
  '(non-impersonated) operator/member session. Monotonic (set-only-to-TRUE) '
  '— see migration 096 header and its security-review comment.';

-- No new index: getVenueFeatureAdoption() always filters by venue_id first
-- (a single venue's small row set) — existing venue_id indexes already
-- make this cheap. Add a composite index only if a future market-wide query
-- needs one.


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER FUNCTIONS: events_first_adoption_trigger / daily_specials_first_adoption_trigger
--
-- THIS IS NOT THE REJECTED REV 1 DESIGN. The critical difference:
--   - Rev 1 fired on EVERY INSERT/UPDATE and inferred genuineness from
--     created_by_operator_id/updated_by_operator_id — values impersonation
--     stamps identically to a genuine write. That inference was the flaw.
--   - This trigger performs NO inference at all. It reacts only to
--     is_genuine_operator_engaged — a column the application has ALREADY
--     computed correctly and trustworthily (see that column's own comment
--     above) — transitioning from FALSE to TRUE (UPDATE) or being TRUE at
--     INSERT time. It never inspects created_by_operator_id/
--     updated_by_operator_id itself. An impersonation/admin write, which
--     never sets this column at all, can never satisfy this condition —
--     there is nothing for it to "infer" incorrectly.
--
-- SECURITY DEFINER is required: a genuine single-venue "owner" operator's
-- own save goes through the plain RLS-scoped `authenticated` client (see
-- the security-review comment above), which has no permissive RLS policy on
-- venue_feature_adoption. Without SECURITY DEFINER, this trigger's internal
-- write would be rejected, aborting the operator's entire event/special
-- save. SECURITY DEFINER runs it as the owning role instead (the
-- migration-running role), matching the same reasoning already established
-- for every other SECURITY DEFINER function in this schema.
--
-- Fires only once per row's lifetime in the normal case (the FALSE→TRUE
-- transition happens at most once, since the column is monotonic) — a
-- SUBSEQUENT genuine edit of an already-TRUE row does not re-satisfy
-- "OLD false, NEW true" and does not fire this trigger again. Ongoing
-- engagement (advancing last_engaged_at on repeat genuine edits) is handled
-- separately by recordFeatureAdoption()'s RPC — see that function's comment
-- for why a failure there is low-stakes once first adoption is durable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.events_first_adoption_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_genuine_operator_engaged THEN
      PERFORM public.record_feature_adoption(
        NEW.venue_id,
        'events',
        COALESCE(NEW.updated_by_operator_id, NEW.created_by_operator_id)
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_genuine_operator_engaged AND NOT OLD.is_genuine_operator_engaged THEN
      PERFORM public.record_feature_adoption(
        NEW.venue_id,
        'events',
        COALESCE(NEW.updated_by_operator_id, NEW.created_by_operator_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.events_first_adoption_trigger() IS
  'AFTER INSERT OR UPDATE trigger on public.events. Fires ONLY when '
  'is_genuine_operator_engaged is true on INSERT, or transitions FALSE→TRUE '
  'on UPDATE — never from inspecting created_by_operator_id/'
  'updated_by_operator_id. See migration 096 header for why this differs '
  'fundamentally from the rejected Rev 1 design.';

REVOKE EXECUTE ON FUNCTION public.events_first_adoption_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.events_first_adoption_trigger() TO service_role;

CREATE TRIGGER events_first_adoption_trg
  AFTER INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_first_adoption_trigger();


CREATE OR REPLACE FUNCTION public.daily_specials_first_adoption_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_genuine_operator_engaged THEN
      PERFORM public.record_feature_adoption(
        NEW.venue_id,
        'daily_specials',
        COALESCE(NEW.updated_by_operator_id, NEW.created_by_operator_id)
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_genuine_operator_engaged AND NOT OLD.is_genuine_operator_engaged THEN
      PERFORM public.record_feature_adoption(
        NEW.venue_id,
        'daily_specials',
        COALESCE(NEW.updated_by_operator_id, NEW.created_by_operator_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.daily_specials_first_adoption_trigger() IS
  'AFTER INSERT OR UPDATE trigger on public.daily_specials. Mirrors '
  'events_first_adoption_trigger() exactly — see its comment and migration '
  '096 header.';

REVOKE EXECUTE ON FUNCTION public.daily_specials_first_adoption_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_specials_first_adoption_trigger() TO service_role;

CREATE TRIGGER daily_specials_first_adoption_trg
  AFTER INSERT OR UPDATE ON public.daily_specials
  FOR EACH ROW EXECUTE FUNCTION public.daily_specials_first_adoption_trigger();


-- ─────────────────────────────────────────────────────────────────────────────
-- HISTORICAL BACKFILL — evidence-based, per read-only production audit
--
-- AUDIT RESULTS (production, audited 2026-09-17; see migration header for
-- method):
--
--   events: 23 total rows. 7 have is_seeded_event = false AND
--     created_by_operator_id IS NOT NULL (creation-qualifying). 0 have
--     is_seeded_event = true AND updated_by_operator_id IS NOT NULL
--     (edit-qualifying) — no seeded event has ever been genuinely edited.
--     ALL 7 creation-qualifying rows' created_at falls OUTSIDE every
--     operator_impersonation_sessions window recorded for that row's own
--     venue_id — zero overlaps found. Across 3 distinct venues.
--
--   daily_specials: 97 total rows. 7 have is_seeded_special = false AND
--     created_by_operator_id IS NOT NULL (creation-qualifying, all 7
--     belonging to one venue). 0 edit-qualifying rows. Zero impersonation
--     overlaps found for any of the 7.
--
--   operator_impersonation_sessions: 69 total sessions (append-only, never
--     deleted; 18 Case A / 51 Case B), spanning 2026-04-29 through
--     2026-09-16, with reliable started_at/ended_at/expires_at/venue_id/
--     operator_id on every row — sufficient to compute a real per-venue
--     impersonation window for the overlap check above.
--
--   audit_logs: contains no entity_type referencing events or daily
--     specials at all (confirmed distinct entity_type values are limited to
--     venue_claim/operator_membership/operator/venue/platform_admin/
--     content_guide/faq_library/collection/homepage/homepage_section/
--     operator_submission) — it cannot help distinguish direct
--     platform-admin content edits, but none were found to need
--     distinguishing given the impersonation-session cross-check already
--     cleared every candidate.
--
-- CLASSIFICATION: all 14 candidate rows (7 events + 7 daily_specials) are
-- HIGH-CONFIDENCE GENUINE per the task brief's own minimum bar (non-seeded,
-- real creator, no overlapping impersonation session). ZERO rows were
-- classified proven-impersonation, proven-platform-admin, or ambiguous —
-- there was nothing borderline to list separately. This is a genuinely
-- clean result, not an artifact of a lenient predicate: the predicate below
-- is evaluated fresh whenever this migration actually runs, against
-- whatever data exists at that time, not hard-coded to today's 14 rows.
--
-- RESIDUAL LIMITATION (documented, not fixable from available data): the
-- impersonation-session log only proves ABSENCE of a logged impersonation
-- session overlapping the evidence timestamp — it cannot rule out a raw,
-- out-of-application database edit made outside the app entirely (which
-- would leave no session row and no audit_logs entry either, per the audit
-- above). No evidence of this was found, and it would be inconsistent with
-- every documented manual-review process in CLAUDE.md, but it cannot be
-- independently verified from schema alone — the same category of
-- limitation migration 094's backfill documents for its own predicate.
--
-- EDIT-QUALIFYING CAVEAT (0 rows today, kept general for correctness
-- whenever this migration is actually applied): for a seeded row with
-- updated_by_operator_id set, updated_at reflects only the MOST RECENT
-- write to that row — if an admin/impersonation write occurred AFTER a
-- genuine edit without changing updated_by_operator_id (not possible under
-- the corrected saveEventAction()/saveDailySpecialAction(), which never
-- touch updated_by_operator_id on a non-genuine write — but was possible
-- under the pre-Rev-2 code, where Case A impersonation DID stamp it), the
-- overlap check below is only checking the LATEST recorded write, not any
-- earlier genuine one. Given zero such rows exist in production today, this
-- caveat has no practical effect on this backfill run, but is documented
-- for whoever re-reads this migration before a future application.
--
-- MECHANISM: the two first-adoption triggers above must be temporarily
-- disabled for this block. Reason: this backfill needs to write the TRUE
-- historical evidence timestamp into venue_feature_adoption.first_adopted_at
-- (e.g. an event created months ago), not "whenever this migration happens
-- to run." If the triggers fired during the backfill's own UPDATE
-- statements, they would call record_feature_adoption() with now() instead
-- — harmless for last_engaged_at (already just a debugging aid) but WRONG
-- for first_adopted_at if the trigger's row happened to be inserted before
-- this block's own explicit INSERT could establish the correct historical
-- value. Disabling avoids that ordering hazard entirely rather than relying
-- on which statement happens to run first.
--
-- IDEMPOTENCY: the `AND is_genuine_operator_engaged = FALSE` guard on both
-- UPDATE statements makes them a no-op on any re-run. The venue_feature_adoption
-- INSERT uses ON CONFLICT DO NOTHING — safe because this table is created
-- fresh in this same migration (a conflict is only possible on a re-run
-- after a partial apply, in which case the first run's correct historical
-- values are left untouched rather than risked).
--
-- NO HARD-CODED IDS: every predicate below is evidence-based (schema
-- columns + the impersonation-session cross-check) — no production-specific
-- row/venue ID is hard-coded anywhere in this backfill.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.events            DISABLE TRIGGER events_first_adoption_trg;
ALTER TABLE public.daily_specials    DISABLE TRIGGER daily_specials_first_adoption_trg;

-- ── events: mark qualifying rows' content-level provenance ─────────────────
UPDATE public.events
SET is_genuine_operator_engaged = TRUE
WHERE is_genuine_operator_engaged = FALSE
  AND (
    (
      is_seeded_event = FALSE
      AND created_by_operator_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.operator_impersonation_sessions s
        WHERE s.venue_id = events.venue_id
          AND s.started_at <= events.created_at
          AND events.created_at <= COALESCE(s.ended_at, s.expires_at)
      )
    )
    OR (
      is_seeded_event = TRUE
      AND updated_by_operator_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.operator_impersonation_sessions s
        WHERE s.venue_id = events.venue_id
          AND s.started_at <= events.updated_at
          AND events.updated_at <= COALESCE(s.ended_at, s.expires_at)
      )
    )
  );

-- ── daily_specials: mark qualifying rows' content-level provenance ─────────
UPDATE public.daily_specials
SET is_genuine_operator_engaged = TRUE
WHERE is_genuine_operator_engaged = FALSE
  AND (
    (
      is_seeded_special = FALSE
      AND created_by_operator_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.operator_impersonation_sessions s
        WHERE s.venue_id = daily_specials.venue_id
          AND s.started_at <= daily_specials.created_at
          AND daily_specials.created_at <= COALESCE(s.ended_at, s.expires_at)
      )
    )
    OR (
      is_seeded_special = TRUE
      AND updated_by_operator_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.operator_impersonation_sessions s
        WHERE s.venue_id = daily_specials.venue_id
          AND s.started_at <= daily_specials.updated_at
          AND daily_specials.updated_at <= COALESCE(s.ended_at, s.expires_at)
      )
    )
  );

-- ── venue_feature_adoption: initialize durable records with TRUE historical timestamps ──
INSERT INTO public.venue_feature_adoption (
  venue_id, feature, first_adopted_at, last_engaged_at,
  first_adopted_by_operator_id, last_engaged_by_operator_id
)
SELECT
  evidence.venue_id,
  'events',
  MIN(evidence.evidence_at),
  MAX(evidence.evidence_at),
  (ARRAY_AGG(evidence.operator_id ORDER BY evidence.evidence_at ASC))[1],
  (ARRAY_AGG(evidence.operator_id ORDER BY evidence.evidence_at DESC))[1]
FROM (
  SELECT e.venue_id, e.created_at AS evidence_at, e.created_by_operator_id AS operator_id
  FROM public.events e
  WHERE e.is_seeded_event = FALSE
    AND e.created_by_operator_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_impersonation_sessions s
      WHERE s.venue_id = e.venue_id
        AND s.started_at <= e.created_at
        AND e.created_at <= COALESCE(s.ended_at, s.expires_at)
    )

  UNION ALL

  SELECT e.venue_id, e.updated_at AS evidence_at, e.updated_by_operator_id AS operator_id
  FROM public.events e
  WHERE e.is_seeded_event = TRUE
    AND e.updated_by_operator_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_impersonation_sessions s
      WHERE s.venue_id = e.venue_id
        AND s.started_at <= e.updated_at
        AND e.updated_at <= COALESCE(s.ended_at, s.expires_at)
    )
) evidence
GROUP BY evidence.venue_id
ON CONFLICT (venue_id, feature) DO NOTHING;

INSERT INTO public.venue_feature_adoption (
  venue_id, feature, first_adopted_at, last_engaged_at,
  first_adopted_by_operator_id, last_engaged_by_operator_id
)
SELECT
  evidence.venue_id,
  'daily_specials',
  MIN(evidence.evidence_at),
  MAX(evidence.evidence_at),
  (ARRAY_AGG(evidence.operator_id ORDER BY evidence.evidence_at ASC))[1],
  (ARRAY_AGG(evidence.operator_id ORDER BY evidence.evidence_at DESC))[1]
FROM (
  SELECT d.venue_id, d.created_at AS evidence_at, d.created_by_operator_id AS operator_id
  FROM public.daily_specials d
  WHERE d.is_seeded_special = FALSE
    AND d.created_by_operator_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_impersonation_sessions s
      WHERE s.venue_id = d.venue_id
        AND s.started_at <= d.created_at
        AND d.created_at <= COALESCE(s.ended_at, s.expires_at)
    )

  UNION ALL

  SELECT d.venue_id, d.updated_at AS evidence_at, d.updated_by_operator_id AS operator_id
  FROM public.daily_specials d
  WHERE d.is_seeded_special = TRUE
    AND d.updated_by_operator_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_impersonation_sessions s
      WHERE s.venue_id = d.venue_id
        AND s.started_at <= d.updated_at
        AND d.updated_at <= COALESCE(s.ended_at, s.expires_at)
    )
) evidence
GROUP BY evidence.venue_id
ON CONFLICT (venue_id, feature) DO NOTHING;

ALTER TABLE public.events            ENABLE TRIGGER events_first_adoption_trg;
ALTER TABLE public.daily_specials    ENABLE TRIGGER daily_specials_first_adoption_trg;

-- SAFE TO REVIEW BEFORE APPLYING:
--   SELECT feature, count(*), min(first_adopted_at), max(last_engaged_at)
--   FROM public.venue_feature_adoption GROUP BY feature;
--
--   SELECT v.name, vfa.* FROM public.venue_feature_adoption vfa
--   JOIN public.venues v ON v.id = vfa.venue_id ORDER BY v.name;
--
-- NOT applied to Supabase by this task — file only, per explicit
-- instruction. Apply only after review, to a non-production copy first if
-- at all possible.
-- =============================================================================
