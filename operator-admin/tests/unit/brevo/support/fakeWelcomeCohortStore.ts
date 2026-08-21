import type { WelcomeCohortStore, WelcomeCohortCandidate } from "../../../../src/lib/brevo/welcomeCohortBackfill";
import type { FakeConsumerProfile } from "./fakeConsumerLookupClient";
import type { FakeOutboxRow } from "./fakeOutboxStore";

/**
 * In-memory stand-in for the WelcomeCohortStore surface
 * (welcomeCohortBackfill.ts), sharing the SAME `profiles` array as
 * createFakeConsumerLookupClient() and the SAME `outboxRows` array as
 * createFakeOutboxStore() — so a test can exercise the real
 * evaluateConsumerBrevoEligibility()/enqueueBrevoContactSync() codepaths
 * together with this store's candidate-selection/cohort-marking logic
 * against one consistent, shared in-memory dataset, the same way a real
 * Supabase transaction would see one consistent Postgres state.
 */
export function createFakeWelcomeCohortStore(
  profiles: FakeConsumerProfile[],
  outboxRows: FakeOutboxRow[]
): WelcomeCohortStore {
  return {
    async countAlreadyInCohort() {
      const count = profiles.filter((p) => !!p.brevo_welcome_backfilled_at).length;
      return { count, error: null };
    },
    async fetchCandidates() {
      const candidates: WelcomeCohortCandidate[] = profiles
        .filter((p) => p.marketing_consent === true && !!p.email && !p.brevo_welcome_backfilled_at)
        .map((p) => ({ id: p.id, email: p.email, marketing_consent: p.marketing_consent }));
      return { candidates, error: null };
    },
    async hasPendingOutboxRow(dedupeKey: string) {
      const exists = outboxRows.some(
        (r) =>
          r.provider === "brevo" &&
          r.dedupe_key === dedupeKey &&
          (r.status === "pending" || r.status === "processing")
      );
      return { exists, error: null };
    },
    async markBackfilled(consumerId: string) {
      const profile = profiles.find((p) => p.id === consumerId);
      if (!profile) return { marked: false, error: `no such profile: ${consumerId}` };
      // Mirrors the real atomic `WHERE brevo_welcome_backfilled_at IS NULL`
      // guard — a consumer already marked is a safe no-op, never re-marked.
      if (profile.brevo_welcome_backfilled_at) return { marked: false, error: null };
      profile.brevo_welcome_backfilled_at = new Date().toISOString();
      return { marked: true, error: null };
    },
  };
}
