import { test } from "node:test";
import assert from "node:assert/strict";
import { resendClaimSetupEmailImpl } from "../../../src/app/control-panel/claims/[id]/resendClaimSetupEmailImpl";

/**
 * Phase 1B correction: resendClaimSetupEmailAction previously used
 * session-only authentication ("is signed in") instead of the canonical
 * isControlPanelAdmin() allowlist check every other founder-only mutation
 * uses. These tests prove the fix behaviorally: a founder passes and
 * proceeds to the next real step; an ordinary authenticated (non-founder)
 * user — or no user at all — is denied with a generic message, and
 * critically, BEFORE the function ever queries venue_claims (i.e. before any
 * claim, lifecycle, recipient, or token/link inspection).
 *
 * WHY THIS TESTS THE IMPL, NOT THE EXPORTED ACTION: the exported
 * `resendClaimSetupEmailAction` (claims/[id]/actions.ts) has a fixed,
 * client-safe signature — `(claimId, prevState, formData)` — with no
 * dependency-override parameter, precisely so a browser/client has no path
 * to influence its authorization or persistence dependencies. The
 * ResendClaimSetupEmailDeps DI seam this file exercises lives entirely on
 * resendClaimSetupEmailImpl() instead, a plain module with no "use server"
 * directive — it is never itself network-reachable, so accepting `deps`
 * there carries none of the risk it would on the exported action. Every real
 * call site (ResendSetupEmailPanel.tsx → the exported action → this impl)
 * omits `deps` entirely and gets the real
 * createClient()/createAdminClient()/isControlPanelAdmin(). See
 * activationLifecycleActionsWiring.test.ts for the tests confirming the
 * exported action's signature truly has no such parameter.
 *
 * Full success (an actual email sent) is not exercised here — that would
 * additionally require faking Resend's sendPasswordSetupEmail and
 * Supabase's generateLink, which aren't behind a DI seam and are out of
 * scope for this authorization-focused correction. "Founder success" here
 * means what actually matters for this fix: the founder gets PAST the
 * authorization gate to the claim lookup, provably further than a
 * non-founder ever gets.
 */

function makeClaimLookupClient() {
  let touched = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      touched = true;
      if (table === "venue_claims") {
        return {
          select() {
            return {
              eq() {
                return { single: async () => ({ data: null, error: { message: "not found" } }) };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table in fake: ${table}`);
    },
  };
  return { client, wasTouched: () => touched };
}

function fakeAuthClient(user: { id: string; email: string } | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { auth: { getUser: async () => ({ data: { user } }) } } as any;
}

const FOUNDER = { id: "founder-1", email: "founder@happyhourcompass.com" };
const NON_FOUNDER = { id: "user-1", email: "operator@example.com" };

test("resendClaimSetupEmailAction: a Control Panel admin (founder) passes authorization and proceeds to the claim lookup", async () => {
  const { client, wasTouched } = makeClaimLookupClient();
  const result = await resendClaimSetupEmailImpl("claim-1", {
    authClient: fakeAuthClient(FOUNDER),
    checkAdmin: async (email) => email === FOUNDER.email,
    adminClient: client,
  });

  assert.notEqual(result.error, "Unauthorized.");
  assert.match(result.error ?? "", /Claim not found/);
  assert.equal(wasTouched(), true, "an authorized founder must reach the claim lookup");
});

test("resendClaimSetupEmailAction: an ordinary authenticated (non-founder) user is denied — generic message, no claim/operator details", async () => {
  const { client } = makeClaimLookupClient();
  const result = await resendClaimSetupEmailImpl("claim-1", {
    authClient: fakeAuthClient(NON_FOUNDER),
    checkAdmin: async () => false,
    adminClient: client,
  });

  assert.equal(result.error, "Unauthorized.");
  assert.equal(result.success, undefined);
});

test("resendClaimSetupEmailAction: authorization is checked BEFORE any claim/lifecycle/recipient lookup — the venue_claims table is never touched for a denied caller", async () => {
  const { client, wasTouched } = makeClaimLookupClient();
  await resendClaimSetupEmailImpl("claim-1", {
    authClient: fakeAuthClient(NON_FOUNDER),
    checkAdmin: async () => false,
    adminClient: client,
  });
  assert.equal(wasTouched(), false, "no venue_claims query should ever run for an unauthorized caller");
});

test("resendClaimSetupEmailAction: no signed-in user at all is denied the same way as a non-founder", async () => {
  const { client, wasTouched } = makeClaimLookupClient();
  const result = await resendClaimSetupEmailImpl("claim-1", {
    authClient: fakeAuthClient(null),
    checkAdmin: async () => true, // even if this were somehow true, no user means denied
    adminClient: client,
  });
  assert.equal(result.error, "Unauthorized.");
  assert.equal(wasTouched(), false);
});
