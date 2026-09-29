-- =============================================================================
-- Happy Hour Compass — Email Send Registry & Open Tracking
-- Migration: 102_email_open_tracking.sql
--
-- STATUS: not yet applied. Apply BEFORE setting EMAIL_OPEN_TRACKING_ENABLED
-- in any environment. Until it is applied (or while that flag is off),
-- sendTransactionalEmail() behaves exactly as before: no registry writes,
-- no Resend tags. The Resend webhook route rejects nothing because of this
-- migration, but cannot persist events until it exists (it returns 500 and
-- Resend retries).
--
-- CONTEXT:
--   Every transactional email HHC code sends goes through ONE function,
--   sendTransactionalEmail() (operator-admin/src/lib/email.ts), via Resend.
--   Before this migration only Customer Success milestone emails kept the
--   provider message id anywhere (customer_success_events.provider_message_id);
--   operator setup, verification-code, reminder and every other email kept
--   nothing, so an open event could never be tied back to a send.
--
-- WHAT A ROW MEANS:
--   email_messages — one row per LOGICAL send. `send_key` is the send's
--     identity: the caller's Resend idempotency key when it has one (so every
--     retry of the same logical email reuses the same row), otherwise a fresh
--     random key (so every distinct send — e.g. a founder "Resend setup
--     email" — gets its own row). `send_ref` (a hash of send_key, never a
--     database id) is sent to Resend as the `hhc_send_ref` tag: the row is
--     inserted BEFORE the provider call, so an open that arrives before the
--     send result is recorded still matches, and because the tag depends
--     only on the send key, a retry can rebuild the exact earlier request
--     even when this database is unavailable.
--
-- OPENS ARE ONLY POSSIBLE FROM A TRACKED DOMAIN: Resend open tracking is a
--   per-domain setting. Every email is registered here, but an "Email
--   opened" event can exist only for a row whose sent_from_domain has open
--   tracking enabled in Resend (the tracked subdomain, e.g.
--   updates.happyhourcompass.com — never the root domain).
--   email_provider_events — one row per verified Resend webhook delivery
--     we act on (currently only `email.opened`), deduplicated by the
--     webhook's own delivery id (`svix-id` / `webhook-id`). No raw payload,
--     no recipient address, no subject is stored — a verification-code
--     email's subject contains the code itself.
--
-- "OPENED" IS NOT "READ": first_opened_at is when the email's images first
-- loaded (Resend's tracking pixel). Privacy proxies (e.g. Apple Mail Privacy
-- Protection) and security scanners can load images without a person, and a
-- forwarded copy reports opens too. UI/Slack label this "Email opened" only.
--
-- ENVIRONMENTS: staging and production share this one database and one
-- Resend account. `environment` records which deployment sent the email;
-- only 'production' rows are ever eligible for #customer-success Slack.
--
-- SECURITY: internal-only — RLS enabled, no permissive policies, service
-- role only (createAdminClient()).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: email_messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_messages (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Logical-send identity: caller's idempotency key, or a random key.
  send_key                    TEXT        NOT NULL,
  -- First 32 hex chars of sha256(send_key); the hhc_send_ref Resend tag.
  send_ref                    TEXT        NOT NULL,
  provider                    TEXT        NOT NULL DEFAULT 'resend',

  -- sendTransactionalEmail()'s `type` (e.g. claim_approval,
  -- customer_success_milestone, operator_verification_code).
  email_type                  TEXT        NOT NULL,

  -- Decided once at registration (emailTrackingPolicy.ts), so a later
  -- policy change never re-routes historical opens.
  open_notification           TEXT        NOT NULL DEFAULT 'none',

  recipient_email             TEXT        NOT NULL,
  environment                 TEXT        NOT NULL,

  -- Optional associations. Only rows with venue_id appear in a venue's
  -- Internal Notes timeline.
  venue_id                    UUID        REFERENCES public.venues(id) ON DELETE SET NULL,
  operator_id                 UUID        REFERENCES public.operators(id) ON DELETE SET NULL,
  lifecycle_id                UUID        REFERENCES public.operator_activation_lifecycles(id) ON DELETE SET NULL,
  customer_success_event_id   UUID        REFERENCES public.customer_success_events(id) ON DELETE SET NULL,
  claim_id                    UUID        REFERENCES public.venue_claims(id) ON DELETE SET NULL,
  submission_id               UUID        REFERENCES public.operator_submissions(id) ON DELETE SET NULL,

  -- Small allowlisted context for labelling only (trigger, reminderStage,
  -- milestone). Never a link, token, code, or subject.
  send_context                JSONB,

  -- Delivery lifecycle of the logical send.
  status                      TEXT        NOT NULL DEFAULT 'pending',
  attempt_count               INTEGER     NOT NULL DEFAULT 0,
  last_attempted_at           TIMESTAMPTZ,
  sent_at                     TIMESTAMPTZ,
  -- Domain of the From address Resend actually accepted. Opens can only be
  -- reported when this domain has Resend open tracking enabled.
  sent_from_domain            TEXT,
  last_error                  TEXT,
  provider_message_id         TEXT,

  -- Open tracking.
  first_opened_at             TIMESTAMPTZ,
  first_open_event_id         UUID,
  open_notified_at            TIMESTAMPTZ,
  open_notify_claimed_at      TIMESTAMPTZ,
  open_notify_attempt_count   INTEGER     NOT NULL DEFAULT 0,
  open_notify_last_error      TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT email_messages_send_key_key UNIQUE (send_key),
  CONSTRAINT email_messages_send_ref_key UNIQUE (send_ref),
  CONSTRAINT email_messages_send_ref_format_check CHECK (send_ref ~ '^[0-9a-f]{32}$'),
  CONSTRAINT email_messages_provider_check CHECK (provider IN ('resend')),
  CONSTRAINT email_messages_open_notification_check CHECK (open_notification IN ('none', 'customer_success')),
  CONSTRAINT email_messages_environment_check CHECK (environment IN ('production', 'preview', 'development')),
  CONSTRAINT email_messages_status_check CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT email_messages_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT email_messages_open_notify_attempt_count_check CHECK (open_notify_attempt_count >= 0)
);

COMMENT ON TABLE public.email_messages IS
  'One row per logical transactional email sent by HHC code through '
  'sendTransactionalEmail() (Resend). Registered before the provider call; '
  'records provider message id, send outcome, and the FIRST open (images '
  'loaded — not proof the message was read). See src/lib/emailTracking/.';
COMMENT ON COLUMN public.email_messages.send_key IS
  'Logical-send identity. The caller''s Resend idempotency key when present '
  '(retries reuse the row), otherwise a random key (each resend is distinct).';
COMMENT ON COLUMN public.email_messages.sent_from_domain IS
  'Sender domain of the accepted request. An open can only ever be recorded '
  'when this domain has Resend open tracking enabled (the tracked subdomain).';
COMMENT ON COLUMN public.email_messages.open_notification IS
  'customer_success = a first open may post to #customer-success (production '
  'rows with a venue only). none = record the open, never notify.';
COMMENT ON COLUMN public.email_messages.first_opened_at IS
  'Earliest Resend email.opened time seen. Images loaded — may be a privacy '
  'proxy, scanner, or forwarded copy. Never label this as "read".';
COMMENT ON COLUMN public.email_messages.open_notify_claimed_at IS
  'Short claim held while a Slack notification is being posted, so the '
  'webhook and the retry cron never post the same notification twice.';

-- One provider message maps to at most one logical send.
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_message_uidx
  ON public.email_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Venue Internal Notes timeline: opened emails for one venue.
CREATE INDEX IF NOT EXISTS email_messages_venue_opened_idx
  ON public.email_messages (venue_id, first_opened_at)
  WHERE venue_id IS NOT NULL AND first_opened_at IS NOT NULL;

-- Slack retry query.
CREATE INDEX IF NOT EXISTS email_messages_open_notify_pending_idx
  ON public.email_messages (first_opened_at)
  WHERE open_notification = 'customer_success'
    AND first_opened_at IS NOT NULL
    AND open_notified_at IS NULL;

CREATE TRIGGER email_messages_updated_at
  BEFORE UPDATE ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: email_provider_events
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_provider_events (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                  TEXT        NOT NULL DEFAULT 'resend',
  -- The webhook delivery id (svix-id). Same value on every Resend retry of
  -- the same delivery — the dedupe key.
  provider_event_id         TEXT        NOT NULL,
  event_type                TEXT        NOT NULL,
  -- Resend's data.email_id.
  provider_message_id       TEXT,
  -- data.tags.hhc_send_ref as received (only trusted after the signature
  -- check, and only used when it names an existing email_messages row).
  tagged_send_ref           TEXT,
  occurred_at               TIMESTAMPTZ NOT NULL,
  received_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_message_id          UUID        REFERENCES public.email_messages(id) ON DELETE SET NULL,
  outcome                   TEXT,
  processed_at              TIMESTAMPTZ,

  CONSTRAINT email_provider_events_provider_event_key UNIQUE (provider, provider_event_id),
  CONSTRAINT email_provider_events_provider_check CHECK (provider IN ('resend')),
  CONSTRAINT email_provider_events_event_type_check CHECK (event_type IN ('email.opened')),
  CONSTRAINT email_provider_events_outcome_check CHECK (outcome IS NULL OR outcome IN ('first_open', 'repeat_open', 'unmatched'))
);

COMMENT ON TABLE public.email_provider_events IS
  'Verified Resend webhook deliveries (email.opened only), deduplicated by '
  'webhook delivery id. processed_at NULL = not yet matched to an '
  'email_messages row (e.g. arrived before the send was recorded); the '
  'email-open-tracking cron retries matching for a bounded window. No '
  'recipient, subject, or raw payload is stored.';

CREATE INDEX IF NOT EXISTS email_provider_events_unprocessed_idx
  ON public.email_provider_events (received_at)
  WHERE processed_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — internal-only, service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_provider_events ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — required for every new public-schema table (see _template.sql).
-- No anon/authenticated access: all reads/writes go through the service-role
-- admin client (sendTransactionalEmail, the Resend webhook route, the cron,
-- and the Control Panel venue Internal Notes loader).
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.email_messages        TO service_role;
GRANT ALL ON public.email_provider_events TO service_role;
