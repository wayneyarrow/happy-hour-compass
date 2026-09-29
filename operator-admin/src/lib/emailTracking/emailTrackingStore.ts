import { createAdminClient } from "@/lib/supabase/server";

/**
 * Persistence for the email send registry & open tracking (migration 102:
 * public.email_messages, public.email_provider_events).
 *
 * A narrow, intention-named interface rather than raw query builders, so the
 * registry, webhook and cron logic can be tested against an in-memory fake
 * (tests/unit/emailTracking/support/fakeEmailTrackingStore.ts) with the same
 * atomicity guarantees the real SQL gives. Every "if unset"/claim method
 * below is ONE conditional UPDATE in Postgres — the database decides the
 * winner, never a read-then-write in application code.
 */

export type EmailMessageRow = {
  id: string;
  send_key: string;
  send_ref: string;
  email_type: string;
  open_notification: string;
  recipient_email: string;
  environment: string;
  venue_id: string | null;
  operator_id: string | null;
  lifecycle_id: string | null;
  customer_success_event_id: string | null;
  claim_id: string | null;
  submission_id: string | null;
  send_context: Record<string, unknown> | null;
  status: string;
  attempt_count: number;
  sent_at: string | null;
  sent_from_domain: string | null;
  provider_message_id: string | null;
  first_opened_at: string | null;
  open_notified_at: string | null;
  open_notify_claimed_at: string | null;
  open_notify_attempt_count: number;
};

export type NewEmailMessage = {
  send_key: string;
  send_ref: string;
  email_type: string;
  open_notification: string;
  recipient_email: string;
  environment: string;
  venue_id: string | null;
  operator_id: string | null;
  lifecycle_id: string | null;
  customer_success_event_id: string | null;
  claim_id: string | null;
  submission_id: string | null;
  send_context: Record<string, unknown> | null;
};

export type ProviderEventRow = {
  id: string;
  provider_event_id: string;
  provider_message_id: string | null;
  tagged_send_ref: string | null;
  occurred_at: string;
  received_at: string;
  processed_at: string | null;
};

export type NewProviderEvent = {
  provider_event_id: string;
  event_type: "email.opened";
  provider_message_id: string | null;
  tagged_send_ref: string | null;
  occurred_at: string;
};

export type LifecycleLinks = {
  operatorId: string | null;
  claimId: string | null;
  submissionId: string | null;
  venueId: string | null;
};

type Err = { error: string };

export interface EmailTrackingStore {
  // ── Registry ──
  /** Inserts a new row; `conflict` when send_key already exists. */
  insertEmailMessage(row: NewEmailMessage): Promise<{ row: EmailMessageRow } | { conflict: true } | Err>;
  findEmailMessageBySendKey(sendKey: string): Promise<EmailMessageRow | null>;
  findEmailMessageById(id: string): Promise<EmailMessageRow | null>;
  findEmailMessageBySendRef(sendRef: string): Promise<EmailMessageRow | null>;
  findEmailMessageByProviderId(providerMessageId: string): Promise<EmailMessageRow | null>;
  markEmailSent(id: string, p: { providerMessageId: string | null; sentFromDomain: string | null; at: string; attemptCount: number }): Promise<void | Err>;
  /** Never downgrades a row that is already 'sent'. */
  markEmailFailed(id: string, p: { error: string; at: string; attemptCount: number }): Promise<void | Err>;
  resolveLifecycleLinks(lifecycleId: string): Promise<LifecycleLinks | null>;
  /** venue_claims.venue_id / operator_submissions.venue_id — null when the origin has no venue yet. */
  resolveOriginVenue(origin: { claimId?: string | null; submissionId?: string | null }): Promise<string | null>;

  // ── Provider events ──
  insertProviderEvent(evt: NewProviderEvent): Promise<{ row: ProviderEventRow } | { duplicate: ProviderEventRow } | Err>;
  markProviderEventProcessed(id: string, p: { outcome: "first_open" | "repeat_open" | "unmatched"; emailMessageId: string | null; at: string }): Promise<void | Err>;
  listUnprocessedProviderEvents(limit: number): Promise<ProviderEventRow[] | Err>;

  // ── First open (atomic) ──
  /** Sets first_opened_at only if still NULL. Returns the updated row when THIS call set it. */
  setFirstOpenIfUnset(id: string, openedAt: string, eventId: string): Promise<EmailMessageRow | null | Err>;
  /** Moves first_opened_at earlier if an out-of-order event is older. Never re-notifies. */
  lowerFirstOpenIfEarlier(id: string, openedAt: string, eventId: string): Promise<void | Err>;

  // ── Slack notification (claim → deliver → mark) ──
  /** Claims the notification if not yet notified and no fresh claim is held. Returns the row when claimed. */
  claimOpenNotification(id: string, now: string, staleClaimBefore: string): Promise<EmailMessageRow | null | Err>;
  markOpenNotified(id: string, at: string): Promise<void | Err>;
  releaseOpenNotificationClaim(id: string, p: { error: string; attemptCount: number }): Promise<void | Err>;
  listPendingOpenNotifications(p: { environment: string; limit: number; maxAttempts: number }): Promise<EmailMessageRow[] | Err>;
  getVenueName(venueId: string): Promise<string | null>;

  // ── Timeline ──
  listOpenedEmailsForVenue(venueId: string): Promise<EmailMessageRow[] | Err>;
}

export function isStoreError(value: unknown): value is Err {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as Err).error === "string";
}

// ── Supabase implementation ──────────────────────────────────────────────────

const MESSAGE_COLUMNS =
  "id, send_key, send_ref, email_type, open_notification, recipient_email, environment, venue_id, operator_id, lifecycle_id, " +
  "customer_success_event_id, claim_id, submission_id, send_context, status, attempt_count, sent_at, sent_from_domain, provider_message_id, " +
  "first_opened_at, open_notified_at, open_notify_claimed_at, open_notify_attempt_count";

const EVENT_COLUMNS = "id, provider_event_id, provider_message_id, tagged_send_ref, occurred_at, received_at, processed_at";

type AdminClient = ReturnType<typeof createAdminClient>;

export function createSupabaseEmailTrackingStore(client: AdminClient = createAdminClient()): EmailTrackingStore {
  const messages = () => client.from("email_messages");
  const events = () => client.from("email_provider_events");
  const asRow = (d: unknown) => d as EmailMessageRow;

  return {
    async insertEmailMessage(row) {
      const { data, error } = await messages().insert(row).select(MESSAGE_COLUMNS).single();
      if (error) return error.code === "23505" ? { conflict: true } : { error: error.message };
      return { row: asRow(data) };
    },

    async findEmailMessageBySendKey(sendKey) {
      const { data } = await messages().select(MESSAGE_COLUMNS).eq("send_key", sendKey).maybeSingle();
      return data ? asRow(data) : null;
    },

    async findEmailMessageById(id) {
      const { data } = await messages().select(MESSAGE_COLUMNS).eq("id", id).maybeSingle();
      return data ? asRow(data) : null;
    },

    async findEmailMessageBySendRef(sendRef) {
      const { data } = await messages().select(MESSAGE_COLUMNS).eq("send_ref", sendRef).maybeSingle();
      return data ? asRow(data) : null;
    },

    async findEmailMessageByProviderId(providerMessageId) {
      const { data } = await messages()
        .select(MESSAGE_COLUMNS)
        .eq("provider", "resend")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      return data ? asRow(data) : null;
    },

    async markEmailSent(id, p) {
      const { error } = await messages()
        .update({
          status: "sent",
          provider_message_id: p.providerMessageId,
          sent_from_domain: p.sentFromDomain,
          sent_at: p.at,
          last_attempted_at: p.at,
          attempt_count: p.attemptCount,
          last_error: null,
        })
        .eq("id", id);
      if (error) return { error: error.message };
    },

    async markEmailFailed(id, p) {
      const { error } = await messages()
        .update({ status: "failed", last_error: p.error, last_attempted_at: p.at, attempt_count: p.attemptCount })
        .eq("id", id)
        .neq("status", "sent");
      if (error) return { error: error.message };
    },

    async resolveLifecycleLinks(lifecycleId) {
      const { data: lc } = await client
        .from("operator_activation_lifecycles")
        .select("operator_id, origin_claim_id, origin_submission_id")
        .eq("id", lifecycleId)
        .maybeSingle();
      if (!lc) return null;
      const claimId = (lc.origin_claim_id as string | null) ?? null;
      const submissionId = (lc.origin_submission_id as string | null) ?? null;
      let venueId: string | null = null;
      if (claimId) {
        const { data } = await client.from("venue_claims").select("venue_id").eq("id", claimId).maybeSingle();
        venueId = (data?.venue_id as string | null) ?? null;
      } else if (submissionId) {
        const { data } = await client.from("operator_submissions").select("venue_id").eq("id", submissionId).maybeSingle();
        venueId = (data?.venue_id as string | null) ?? null;
      }
      return { operatorId: (lc.operator_id as string | null) ?? null, claimId, submissionId, venueId };
    },

    async resolveOriginVenue(origin) {
      if (origin.claimId) {
        const { data } = await client.from("venue_claims").select("venue_id").eq("id", origin.claimId).maybeSingle();
        return (data?.venue_id as string | null) ?? null;
      }
      if (origin.submissionId) {
        const { data } = await client.from("operator_submissions").select("venue_id").eq("id", origin.submissionId).maybeSingle();
        return (data?.venue_id as string | null) ?? null;
      }
      return null;
    },

    async insertProviderEvent(evt) {
      const { data, error } = await events().insert({ ...evt, provider: "resend" }).select(EVENT_COLUMNS).single();
      if (!error) return { row: data as ProviderEventRow };
      if (error.code !== "23505") return { error: error.message };
      const { data: existing, error: readError } = await events()
        .select(EVENT_COLUMNS)
        .eq("provider", "resend")
        .eq("provider_event_id", evt.provider_event_id)
        .maybeSingle();
      if (readError || !existing) return { error: readError?.message ?? "duplicate event row not readable" };
      return { duplicate: existing as ProviderEventRow };
    },

    async markProviderEventProcessed(id, p) {
      const { error } = await events()
        .update({ outcome: p.outcome, email_message_id: p.emailMessageId, processed_at: p.at })
        .eq("id", id);
      if (error) return { error: error.message };
    },

    async listUnprocessedProviderEvents(limit) {
      const { data, error } = await events()
        .select(EVENT_COLUMNS)
        .is("processed_at", null)
        .order("received_at", { ascending: true })
        .limit(limit);
      if (error) return { error: error.message };
      return (data ?? []) as ProviderEventRow[];
    },

    async setFirstOpenIfUnset(id, openedAt, eventId) {
      const { data, error } = await messages()
        .update({ first_opened_at: openedAt, first_open_event_id: eventId })
        .eq("id", id)
        .is("first_opened_at", null)
        .select(MESSAGE_COLUMNS);
      if (error) return { error: error.message };
      return data && data.length > 0 ? asRow(data[0]) : null;
    },

    async lowerFirstOpenIfEarlier(id, openedAt, eventId) {
      const { error } = await messages()
        .update({ first_opened_at: openedAt, first_open_event_id: eventId })
        .eq("id", id)
        .gt("first_opened_at", openedAt);
      if (error) return { error: error.message };
    },

    async claimOpenNotification(id, now, staleClaimBefore) {
      const { data, error } = await messages()
        .update({ open_notify_claimed_at: now })
        .eq("id", id)
        .is("open_notified_at", null)
        .or(`open_notify_claimed_at.is.null,open_notify_claimed_at.lt.${staleClaimBefore}`)
        .select(MESSAGE_COLUMNS);
      if (error) return { error: error.message };
      return data && data.length > 0 ? asRow(data[0]) : null;
    },

    async markOpenNotified(id, at) {
      const { error } = await messages()
        .update({ open_notified_at: at, open_notify_claimed_at: null, open_notify_last_error: null })
        .eq("id", id);
      if (error) return { error: error.message };
    },

    async releaseOpenNotificationClaim(id, p) {
      const { error } = await messages()
        .update({ open_notify_claimed_at: null, open_notify_last_error: p.error, open_notify_attempt_count: p.attemptCount })
        .eq("id", id)
        .is("open_notified_at", null);
      if (error) return { error: error.message };
    },

    async listPendingOpenNotifications(p) {
      const { data, error } = await messages()
        .select(MESSAGE_COLUMNS)
        .eq("open_notification", "customer_success")
        .eq("environment", p.environment)
        .not("first_opened_at", "is", null)
        .not("venue_id", "is", null)
        .is("open_notified_at", null)
        .lt("open_notify_attempt_count", p.maxAttempts)
        .order("first_opened_at", { ascending: true })
        .limit(p.limit);
      if (error) return { error: error.message };
      return (data ?? []).map(asRow);
    },

    async getVenueName(venueId) {
      const { data } = await client.from("venues").select("name").eq("id", venueId).maybeSingle();
      return (data?.name as string | undefined) ?? null;
    },

    async listOpenedEmailsForVenue(venueId) {
      const { data, error } = await messages()
        .select(MESSAGE_COLUMNS)
        .eq("venue_id", venueId)
        .not("first_opened_at", "is", null)
        .order("first_opened_at", { ascending: false })
        .limit(200);
      if (error) return { error: error.message };
      return (data ?? []).map(asRow);
    },
  };
}
