-- =============================================================================
-- Migration 055: Content Engine Distribution & Merchandising
--
-- Card 6B — see docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md section 13
-- "Distribution" (the spec's own description of this exact split) and the
-- Card 6A audit that recommended this design.
--
-- Two tables, deliberately separate, mapping 1:1 onto the product principle:
--
--   content_guide_channels    — Content Engine owns this. A row means "an
--                                editor marked this guide eligible for this
--                                channel." Editorial intent, not placement.
--
--   content_guide_placements  — Discover Management owns this. A row means
--                                "this guide is actually merchandised in
--                                this channel, in this order, active or not."
--
-- The composite foreign key from content_guide_placements to
-- content_guide_channels (guide_id, channel_key) is what makes "Discover
-- Management can only merchandise what Content Engine made eligible" a
-- database guarantee rather than an application convention: a placement
-- row cannot exist unless the matching channel-eligibility row exists, and
-- revoking eligibility (deleting the channel row) automatically cascades
-- to remove any placement.
--
-- channel_key is deliberately plain TEXT with NO CHECK constraint. The
-- card requires the design to "support future distribution channels
-- without requiring repeated schema redesign" — a CHECK-constrained enum
-- would need an ALTER TABLE every time a channel is added (e.g.
-- city_homepage, neighbourhood_homepage, seasonal_collection — see Card 6B
-- Part 6). The known channel set for V1 (guides_library, market_homepage)
-- is validated at the application layer (contentGuideDistributionShared.ts)
-- instead. Every write to both tables goes through createAdminClient() from
-- Control Panel server actions, so this is a safe, deliberate trade-off,
-- not an oversight.
--
-- Both tables are additive and internal-only, following the exact
-- admin-only pattern used by content_guides (052) and the attachment
-- tables (053): RLS enabled, no permissive policies, service-role only.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: content_guide_channels  (Content Engine — eligibility)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_guide_channels (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  guide_id     UUID        NOT NULL REFERENCES public.content_guides(id) ON DELETE CASCADE,
  channel_key  TEXT        NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_guide_channels_guide_channel_unique UNIQUE (guide_id, channel_key)
);

COMMENT ON TABLE public.content_guide_channels IS
  'Content Engine editorial intent: a row means an editor marked this guide '
  'eligible for this distribution channel. Does NOT mean the guide is '
  'actually merchandised there — see content_guide_placements. '
  'channel_key is validated at the application layer, not via CHECK, so new '
  'channels never require a migration (see migration header comment).';

CREATE INDEX IF NOT EXISTS content_guide_channels_guide_id_idx
  ON public.content_guide_channels (guide_id);

ALTER TABLE public.content_guide_channels ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service-role bypasses RLS and is the only caller.

GRANT ALL ON public.content_guide_channels TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: content_guide_placements  (Discover Management — merchandising)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_guide_placements (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  guide_id     UUID        NOT NULL,
  channel_key  TEXT        NOT NULL,

  sort_order   INTEGER     NOT NULL DEFAULT 0,
  is_active    BOOLEAN     NOT NULL DEFAULT true,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT,

  CONSTRAINT content_guide_placements_guide_channel_unique UNIQUE (guide_id, channel_key),

  -- The enforcement point: a placement can only exist for a (guide, channel)
  -- pair that Content Engine has already marked eligible. Deleting the
  -- eligibility row cascades here automatically.
  CONSTRAINT content_guide_placements_requires_eligibility
    FOREIGN KEY (guide_id, channel_key)
    REFERENCES public.content_guide_channels (guide_id, channel_key)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.content_guide_placements IS
  'Discover Management merchandising: ordering + active/inactive per '
  '(guide, channel). Market scoping is intentionally NOT duplicated onto '
  'this table — a guide''s market can be edited in Content Engine, so '
  'market context is always read live via content_guides.market_id (join), '
  'never denormalized here.';

CREATE INDEX IF NOT EXISTS content_guide_placements_channel_key_idx
  ON public.content_guide_placements (channel_key, sort_order);

CREATE INDEX IF NOT EXISTS content_guide_placements_guide_id_idx
  ON public.content_guide_placements (guide_id);

CREATE TRIGGER content_guide_placements_updated_at
  BEFORE UPDATE ON public.content_guide_placements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.content_guide_placements ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service-role bypasses RLS and is the only caller.

GRANT ALL ON public.content_guide_placements TO service_role;
