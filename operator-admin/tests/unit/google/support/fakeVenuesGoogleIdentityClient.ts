/**
 * In-memory stand-in for the narrow venues surface reconcileVenueGoogleIdentity()
 * needs (VenuesGoogleIdentityClient), so it can be unit-tested without a real
 * Postgres. Mirrors the fake-store pattern already used for Brevo
 * (tests/unit/brevo/support/fakeOutboxStore.ts).
 */
import type { VenuesGoogleIdentityClient } from "../../../../src/lib/google/reconcileVenueGoogleIdentity";

export type FakeVenueRow = {
  id: string;
  place_id: string | null;
  google_identity_status: string | null;
  google_rating?: number | null;
  google_review_count?: number | null;
};

export function createFakeVenuesGoogleIdentityClient(rows: FakeVenueRow[]): {
  client: VenuesGoogleIdentityClient;
  rows: FakeVenueRow[];
} {
  const client: VenuesGoogleIdentityClient = {
    from(table: "venues") {
      if (table !== "venues") {
        throw new Error(`fakeVenuesGoogleIdentityClient: unexpected table "${table}"`);
      }
      return {
        select(_columns: string) {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  const row = rows.find((r) => (r as unknown as Record<string, unknown>)[column] === value);
                  return { data: row ? (row as unknown as Record<string, unknown>) : null, error: null };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              const row = rows.find((r) => (r as unknown as Record<string, unknown>)[column] === value);
              if (!row) return { data: null, error: { message: "not found" } };
              Object.assign(row, patch);
              return { data: null, error: null };
            },
          };
        },
      };
    },
  };

  return { client, rows };
}
