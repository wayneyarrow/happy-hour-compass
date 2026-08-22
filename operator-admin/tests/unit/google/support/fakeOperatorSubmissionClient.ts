/**
 * In-memory stand-in for the narrow `venues` / `operator_submissions`
 * surface saveOperatorSubmissionAction's Case A path needs
 * ((consumer)/suggest/owner/actions.ts), so the venue-creation →
 * submission-creation → link sequence can be regression-tested without a
 * real Postgres. Mirrors the fake-store pattern already used for Google
 * identity reconciliation (fakeVenuesGoogleIdentityClient.ts).
 *
 * Deliberately enforces the SAME foreign key the real database does —
 * venues.source_submission_id -> operator_submissions.id, NOT DEFERRABLE
 * (supabase/migrations/013_venue_source_attribution.sql) — rather than
 * accepting any insert/update unconditionally. A fully-permissive fake
 * would not have caught the Casa de Frida regression (Postgres error
 * 23503); this one does, by construction.
 */

export type FakeVenueRow = Record<string, unknown> & {
  id: string;
  source_submission_id: string | null;
};

export type FakeSubmissionRow = Record<string, unknown> & {
  id: string;
  venue_id: string | null;
};

/** Same shape Postgres/PostgREST actually returns for this specific FK violation — see the Casa de Frida production log. */
function fkViolation(submissionId: string) {
  return {
    code: "23503",
    details: `Key (source_submission_id)=(${submissionId}) is not present in table "operator_submissions".`,
    hint: null,
    message:
      'insert or update on table "venues" violates foreign key constraint "venues_source_submission_id_fk"',
  };
}

export function createFakeOperatorSubmissionClient() {
  const venues: FakeVenueRow[] = [];
  const submissions: FakeSubmissionRow[] = [];
  let nextVenueId = 1;

  function venuesTable() {
    return {
      insert(row: Record<string, unknown>) {
        return {
          select(_columns: string) {
            return {
              async single() {
                const sourceSubmissionId = row.source_submission_id as string | null | undefined;
                if (
                  sourceSubmissionId != null &&
                  !submissions.some((s) => s.id === sourceSubmissionId)
                ) {
                  // The exact failure mode reproduced in production: a
                  // venue insert referencing a submission id that doesn't
                  // exist yet.
                  return { data: null, error: fkViolation(sourceSubmissionId) };
                }
                const id = `venue-${nextVenueId++}`;
                const newRow = {
                  source_submission_id: null,
                  ...row,
                  id,
                } as FakeVenueRow;
                venues.push(newRow);
                return { data: { id }, error: null };
              },
            };
          },
        };
      },
      update(patch: Record<string, unknown>) {
        return {
          async eq(column: string, value: unknown) {
            const patchSubmissionId = patch.source_submission_id as string | null | undefined;
            if (
              patchSubmissionId != null &&
              !submissions.some((s) => s.id === patchSubmissionId)
            ) {
              return { error: fkViolation(patchSubmissionId) };
            }
            const found = venues.find((v) => v[column] === value);
            if (!found) return { error: { message: `venues: no row with ${column}=${value}` } };
            Object.assign(found, patch);
            return { error: null };
          },
        };
      },
      select(_columns: string) {
        return {
          eq(column: string, value: unknown) {
            return {
              async maybeSingle() {
                const found = venues.find((v) => v[column] === value);
                return { data: found ?? null, error: null };
              },
            };
          },
        };
      },
    };
  }

  function operatorSubmissionsTable() {
    return {
      insert(row: Record<string, unknown>) {
        return {
          select(_columns: string) {
            return {
              async single() {
                const id = (row.id as string | undefined) ?? `submission-${submissions.length + 1}`;
                const newRow = { venue_id: null, ...row, id } as FakeSubmissionRow;
                submissions.push(newRow);
                return { data: { id }, error: null };
              },
            };
          },
        };
      },
    };
  }

  // Overloaded so each call site's literal table name narrows the return
  // shape correctly (a single unioned signature would make `from("venues")`
  // return a type that also allows the operator_submissions shape, which
  // doesn't have `update`/`select`).
  function from(table: "venues"): ReturnType<typeof venuesTable>;
  function from(table: "operator_submissions"): ReturnType<typeof operatorSubmissionsTable>;
  function from(table: "venues" | "operator_submissions") {
    return table === "venues" ? venuesTable() : operatorSubmissionsTable();
  }

  const client = { from };

  return { client, venues, submissions };
}
