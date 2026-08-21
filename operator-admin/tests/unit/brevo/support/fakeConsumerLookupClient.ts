import type { ConsumerLookupClient } from "../../../../src/lib/brevo/consumerEligibility";

export type FakeConsumerProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  marketing_consent: boolean;
  /**
   * Optional — only used by the welcome-cohort backfill tests
   * (fakeWelcomeCohortStore.ts). Absent/undefined everywhere else, matching
   * production consumer_profiles rows that predate migration 078.
   */
  brevo_welcome_backfilled_at?: string | null;
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
            ilike(column: string, pattern: string) {
              return {
                async maybeSingle() {
                  const target = pattern.toLowerCase();
                  const row = profiles.find((p) => {
                    const v = (p as unknown as Record<string, unknown>)[column];
                    return typeof v === "string" && v.toLowerCase() === target;
                  });
                  return { data: row ? ({ ...row } as Record<string, unknown>) : null, error: null };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              const row = profiles.find((p) => (p as unknown as Record<string, unknown>)[column] === value);
              if (row) Object.assign(row, patch);
              return { error: null };
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
