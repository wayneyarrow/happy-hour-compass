-- =============================================================================
-- 049_event_platform_foundation.sql
--
-- Adds ticketing and content-origin fields to the events table to support
-- the Event Detail page and future plan-based event entitlements.
--
-- New columns:
--   ticket_url          TEXT     — URL for purchasing tickets (nullable)
--   ticketing_enabled   BOOLEAN  — when true, a ticket purchase link is active
--   sold_out            BOOLEAN  — when true, consumer UI shows "Sold Out" instead
--                                  of a "Get Tickets" button
--   is_seeded_event     BOOLEAN  — platform-created content flag
--
-- Backfill:
--   All existing rows are treated as seeded platform content:
--     is_seeded_event   = TRUE
--     ticketing_enabled = FALSE
--     sold_out          = FALSE
--
-- Future entitlement intent (deferred — no enforcement in this migration):
--   • Seeded events may always be edited by any plan.
--   • Free plans cannot create additional events beyond their seeded ones.
--   • Pro / Premium plans may create new events according to plan limits.
--   New operator-created events will be inserted with is_seeded_event = FALSE.
-- =============================================================================

-- ── New columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS ticket_url        TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS ticketing_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sold_out          BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_seeded_event   BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Column documentation ──────────────────────────────────────────────────────

COMMENT ON COLUMN public.events.ticket_url IS
  'URL for purchasing tickets. Only meaningful when ticketing_enabled = TRUE. '
  'Stored even when sold_out = TRUE so the URL is preserved if the event reopens.';

COMMENT ON COLUMN public.events.ticketing_enabled IS
  'When TRUE, the consumer UI renders a "Get Tickets" button linking to ticket_url. '
  'When FALSE, no ticket link is shown regardless of ticket_url.';

COMMENT ON COLUMN public.events.sold_out IS
  'When TRUE and ticketing_enabled = TRUE, the consumer UI displays "Sold Out" '
  'instead of "Get Tickets". ticket_url is preserved for operator reference.';

COMMENT ON COLUMN public.events.is_seeded_event IS
  'TRUE for events imported or created by the platform (seeded content). '
  'FALSE for events created directly by operators after this migration. '
  'Future plan enforcement: free operators may edit seeded events but cannot '
  'create additional non-seeded events. Pro/Premium operators may create new '
  'events within their plan limits. Enforcement is deferred — see task docs.';

-- ── Backfill existing rows ────────────────────────────────────────────────────
-- All events that existed before this migration are platform-seeded content.
-- ticketing_enabled and sold_out are already FALSE by DEFAULT, but the UPDATE
-- is explicit for clarity and to handle any rows that may have slipped through.

UPDATE public.events
SET
  is_seeded_event   = TRUE,
  ticketing_enabled = FALSE,
  sold_out          = FALSE
WHERE is_seeded_event = FALSE;
