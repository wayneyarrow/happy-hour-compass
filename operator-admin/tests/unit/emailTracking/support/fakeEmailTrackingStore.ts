/**
 * In-memory EmailTrackingStore reproducing migration 102's constraints and
 * the conditional-UPDATE semantics of the real Supabase store:
 *   - UNIQUE(send_key), UNIQUE(provider, provider_message_id), UNIQUE(provider, provider_event_id)
 *   - setFirstOpenIfUnset / claimOpenNotification only succeed when their WHERE holds.
 * Everything is synchronous inside each method, so (like one SQL statement)
 * no two calls can both "win" the same conditional update.
 */
import type {
  EmailMessageRow,
  EmailTrackingStore,
  LifecycleLinks,
  NewEmailMessage,
  NewProviderEvent,
  ProviderEventRow,
} from "../../../../src/lib/emailTracking/emailTrackingStore";

export type FakeState = {
  messages: EmailMessageRow[];
  events: (ProviderEventRow & { outcome: string | null; email_message_id: string | null })[];
  lifecycles: Record<string, LifecycleLinks>;
  originVenues: Record<string, string>;
  venues: Record<string, string>;
  fail: Partial<Record<"insertEmailMessage" | "insertProviderEvent" | "markEmailSent" | "setFirstOpenIfUnset", boolean>>;
  calls: string[];
};

let counter = 0;
const uuid = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

export function createFakeEmailTrackingStore(seed: Partial<FakeState> = {}): { store: EmailTrackingStore; state: FakeState } {
  const state: FakeState = {
    messages: [],
    events: [],
    lifecycles: {},
    originVenues: {},
    venues: {},
    fail: {},
    calls: [],
    ...seed,
  };
  const find = (id: string) => state.messages.find((m) => m.id === id) ?? null;
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  const store: EmailTrackingStore = {
    async insertEmailMessage(row: NewEmailMessage) {
      state.calls.push("insertEmailMessage");
      if (state.fail.insertEmailMessage) return { error: "db down" };
      if (state.messages.some((m) => m.send_key === row.send_key || m.send_ref === row.send_ref)) return { conflict: true };
      const inserted: EmailMessageRow = {
        id: uuid(),
        ...row,
        status: "pending",
        attempt_count: 0,
        sent_at: null,
        sent_from_domain: null,
        provider_message_id: null,
        first_opened_at: null,
        open_notified_at: null,
        open_notify_claimed_at: null,
        open_notify_attempt_count: 0,
      };
      state.messages.push(inserted);
      return { row: copy(inserted) };
    },
    async findEmailMessageBySendKey(sendKey) {
      const m = state.messages.find((x) => x.send_key === sendKey);
      return m ? copy(m) : null;
    },
    async findEmailMessageById(id) {
      const m = find(id);
      return m ? copy(m) : null;
    },
    async findEmailMessageBySendRef(ref) {
      const m = state.messages.find((x) => x.send_ref === ref);
      return m ? copy(m) : null;
    },
    async findEmailMessageByProviderId(pid) {
      const m = state.messages.find((x) => x.provider_message_id === pid);
      return m ? copy(m) : null;
    },
    async markEmailSent(id, p) {
      state.calls.push("markEmailSent");
      if (state.fail.markEmailSent) return { error: "db down" };
      if (state.messages.some((m) => m.id !== id && p.providerMessageId && m.provider_message_id === p.providerMessageId)) {
        return { error: "duplicate provider_message_id" };
      }
      const m = find(id);
      if (m) Object.assign(m, { status: "sent", provider_message_id: p.providerMessageId, sent_from_domain: p.sentFromDomain, sent_at: p.at, attempt_count: p.attemptCount });
    },
    async markEmailFailed(id, p) {
      const m = find(id);
      if (m && m.status !== "sent") Object.assign(m, { status: "failed", attempt_count: p.attemptCount });
    },
    async resolveLifecycleLinks(lifecycleId) {
      return state.lifecycles[lifecycleId] ?? null;
    },
    async resolveOriginVenue(origin) {
      const key = origin.claimId ?? origin.submissionId;
      return key ? state.originVenues[key] ?? null : null;
    },
    async insertProviderEvent(evt: NewProviderEvent) {
      state.calls.push("insertProviderEvent");
      if (state.fail.insertProviderEvent) return { error: "db down" };
      const existing = state.events.find((e) => e.provider_event_id === evt.provider_event_id);
      if (existing) return { duplicate: copy(existing) };
      const row = {
        id: uuid(),
        provider_event_id: evt.provider_event_id,
        provider_message_id: evt.provider_message_id,
        tagged_send_ref: evt.tagged_send_ref,
        occurred_at: evt.occurred_at,
        received_at: new Date().toISOString(),
        processed_at: null,
        outcome: null,
        email_message_id: null,
      };
      state.events.push(row);
      return { row: copy(row) };
    },
    async markProviderEventProcessed(id, p) {
      const e = state.events.find((x) => x.id === id);
      if (e) Object.assign(e, { outcome: p.outcome, email_message_id: p.emailMessageId, processed_at: p.at });
    },
    async listUnprocessedProviderEvents(limit) {
      return copy(state.events.filter((e) => e.processed_at === null).slice(0, limit));
    },
    async setFirstOpenIfUnset(id, openedAt) {
      if (state.fail.setFirstOpenIfUnset) return { error: "db down" };
      const m = find(id);
      if (!m || m.first_opened_at !== null) return null;
      m.first_opened_at = openedAt;
      return copy(m);
    },
    async lowerFirstOpenIfEarlier(id, openedAt) {
      const m = find(id);
      if (m && m.first_opened_at && m.first_opened_at > openedAt) m.first_opened_at = openedAt;
    },
    async claimOpenNotification(id, now, staleBefore) {
      const m = find(id);
      if (!m || m.open_notified_at !== null) return null;
      if (m.open_notify_claimed_at !== null && !(m.open_notify_claimed_at < staleBefore)) return null;
      m.open_notify_claimed_at = now;
      return copy(m);
    },
    async markOpenNotified(id, at) {
      const m = find(id);
      if (m) Object.assign(m, { open_notified_at: at, open_notify_claimed_at: null });
    },
    async releaseOpenNotificationClaim(id, p) {
      const m = find(id);
      if (m && m.open_notified_at === null) Object.assign(m, { open_notify_claimed_at: null, open_notify_attempt_count: p.attemptCount });
    },
    async listPendingOpenNotifications(p) {
      return copy(
        state.messages.filter(
          (m) =>
            m.open_notification === "customer_success" &&
            m.environment === p.environment &&
            m.first_opened_at !== null &&
            m.venue_id !== null &&
            m.open_notified_at === null &&
            m.open_notify_attempt_count < p.maxAttempts
        )
      ).slice(0, p.limit);
    },
    async getVenueName(venueId) {
      return state.venues[venueId] ?? null;
    },
    async listOpenedEmailsForVenue(venueId) {
      return copy(state.messages.filter((m) => m.venue_id === venueId && m.first_opened_at !== null));
    },
  };
  return { store, state };
}
