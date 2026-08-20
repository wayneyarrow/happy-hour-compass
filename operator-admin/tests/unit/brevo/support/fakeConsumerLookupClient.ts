import type { ConsumerLookupClient } from "../../../../src/lib/brevo/consumerEligibility";

export type FakeConsumerProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  marketing_consent: boolean;
};

export type FakeAuthUser = {
  id: string;
  email_confirmed_at: string | null;
};

/**
 * In-memory stand-in for the narrow ConsumerLookupClient surface
 * (consumer_profiles reads + auth.admin.getUserById), so
 * consumerEligibility.ts / consumerSync.ts can be unit-tested without a
 * real Supabase project.
 */
export function createFakeConsumerLookupClient(opts: {
  profiles?: FakeConsumerProfile[];
  authUsers?: FakeAuthUser[];
}): ConsumerLookupClient {
  const profiles = opts.profiles ?? [];
  const authUsers = opts.authUsers ?? [];

  return {
    from(table: string) {
      if (table !== "consumer_profiles") {
        throw new Error(`fakeConsumerLookupClient: unexpected table "${table}"`);
      }
      return {
        select(_columns: string) {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  const row = profiles.find((p) => (p as unknown as Record<string, unknown>)[column] === value);
                  return { data: row ? ({ ...row } as Record<string, unknown>) : null, error: null };
                },
              };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async getUserById(id: string) {
          const user = authUsers.find((u) => u.id === id);
          if (!user) return { data: { user: null }, error: null };
          return { data: { user: { email_confirmed_at: user.email_confirmed_at } }, error: null };
        },
      },
    },
  };
}
