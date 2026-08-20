-- =============================================================================
-- Happy Hour Compass — Brevo Webhook Events
-- Migration: 076_brevo_webhook_events.sql
--
-- PURPOSE:
--   Durable, idempotent landing zone for authenticated inbound Brevo webhook
--   deliveries (POST /api/webhooks/brevo). Phase 1 scope is Marketing
--   `unsubscribe` events only — this table persists the authenticated,
--   validated event so Phase 2 can connect it to an actual
--   consumer_profiles.marketing_consent update. Phase 1 deliberately does
--   NOT write to consumer_profiles from this table — see
--   src/app/api/webhooks/brevo/route.ts.
--
-- DEDUPE:
--   Brevo (like most webhook senders) delivers at-least-once — retries on a
--   non-2xx response, and Brevo's own docs do not guarantee a single stable
--   per-event-instance ID field name across marketing webhook event types
--   that this integration can rely on with certainty (confirmed by
--   documentation research at implementation time — the real Brevo webhook
--   is only being configured after this endpoint ships, so the exact
--   payload shape delivered in production cannot be fully pinned down yet
--   either). `dedupe_key` is therefore a SHA-256 hash of the canonicalized
--   (sorted-keys) raw payload, computed in
--   src/lib/brevo/webhookDedupe.ts — a genuine byte-for-byte redelivery of
--   the same event always produces the same hash, independent of which
--   specific field names Brevo's marketing webhook turns out to use. The
--   UNIQUE constraint on dedupe_key makes a duplicate insert a no-op
--   (ON CONFLICT DO NOTHING) rather than a duplicate row.
--
-- PRIVACY:
--   `email` is stored because Phase 2 cannot resolve which consumer
--   unsubscribed without it — it is the minimum necessary field. Other
--   payload contents are kept in `raw_payload` for diagnostics only.
--
-- RLS / GRANTs: internal-only, mirrors brevo_sync_outbox (075) and
-- crm_venue_contacts (074) — RLS enabled, zero permissive policies,
-- service_role-only GRANT.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: brevo_webhook_events
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brevo_webhook_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  provider       TEXT        NOT NULL DEFAULT 'brevo',
  event_type     TEXT        NOT NULL,
  dedupe_key     TEXT        NOT NULL,

  email          TEXT,
  raw_payload    JSONB       NOT NULL,

  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT brevo_webhook_events_provider_check
    CHECK (provider IN ('brevo')),
  CONSTRAINT brevo_webhook_events_event_type_check
    CHECK (event_type IN ('unsubscribe', 'unrecognized')),
  CONSTRAINT brevo_webhook_events_dedupe_key_key
    UNIQUE (provider, dedupe_key)
);

COMMENT ON TABLE public.brevo_webhook_events IS
  'Authenticated, deduplicated landing zone for inbound Brevo webhook '
  'deliveries. Phase 1 scope: Marketing unsubscribe only. processed_at stays '
  'NULL until a future phase actually applies the event to consumer state.';

COMMENT ON COLUMN public.brevo_webhook_events.event_type IS
  '"unsubscribe": a recognized Marketing unsubscribe event. "unrecognized": '
  'an authenticated delivery whose event type Phase 1 does not act on — '
  'stored for visibility rather than silently dropped, per the requirement '
  'that only unsubscribe is processed while other event types are safely '
  'ignored (not subscribed to opens/clicks/deliveries by design).';

COMMENT ON COLUMN public.brevo_webhook_events.dedupe_key IS
  'SHA-256 of the canonicalized raw payload (see src/lib/brevo/webhookDedupe.ts). '
  'A genuine Brevo redelivery of the same event hashes identically; the '
  'UNIQUE constraint makes re-insertion a safe no-op.';

COMMENT ON COLUMN public.brevo_webhook_events.processed_at IS
  'Set by a future phase once the event has actually been applied to '
  'consumer_profiles.marketing_consent. Always NULL in Phase 1.';


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS brevo_webhook_events_received_at_idx
  ON public.brevo_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS brevo_webhook_events_email_idx
  ON public.brevo_webhook_events (email)
  WHERE (email IS NOT NULL);

-- Future phase's processing queue: unprocessed recognized events.
CREATE INDEX IF NOT EXISTS brevo_webhook_events_unprocessed_idx
  ON public.brevo_webhook_events (received_at)
  WHERE (event_type = 'unsubscribe' AND processed_at IS NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — internal-only, no permissive policies.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.brevo_webhook_events ENABLE ROW LEVEL SECURITY;

-- No permissive policies — intentional. Reachable only via createAdminClient()
-- (service-role) from src/app/api/webhooks/brevo/route.ts.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only. No anon, no authenticated.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.brevo_webhook_events TO service_role;
