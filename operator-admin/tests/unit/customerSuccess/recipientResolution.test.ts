import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRecipientFromActiveMemberships,
  getActiveOperatorMemberships,
  type ActiveMembershipLike,
} from "../../../src/lib/customerSuccess/recipientResolution";

// ── 1. Designated admin/owner selected ──────────────────────────────────────

test("an active owner is always preferred, even alongside active members", () => {
  const memberships: ActiveMembershipLike[] = [
    { role: "member", email: "team@example.com", fullName: "Team Person" },
    { role: "owner", email: "owner@example.com", fullName: "Kelly Owner" },
  ];
  const result = resolveRecipientFromActiveMemberships(memberships);
  assert.deepEqual(result, { ok: true, recipient: { email: "owner@example.com", firstName: "Kelly", role: "owner" } });
});

// ── 2. Exactly one active user fallback ─────────────────────────────────────

test("no owner, but exactly one active member: use that person", () => {
  const memberships: ActiveMembershipLike[] = [{ role: "member", email: "solo@example.com", fullName: "Sam Solo" }];
  const result = resolveRecipientFromActiveMemberships(memberships);
  assert.deepEqual(result, { ok: true, recipient: { email: "solo@example.com", firstName: "Sam", role: "member" } });
});

// ── 3. Multiple active users, no admin → blocked ────────────────────────────

test("multiple active members and no owner: blocked as ambiguous, never guessed", () => {
  const memberships: ActiveMembershipLike[] = [
    { role: "member", email: "a@example.com", fullName: "Alex A" },
    { role: "member", email: "b@example.com", fullName: "Bailey B" },
  ];
  const result = resolveRecipientFromActiveMemberships(memberships);
  assert.deepEqual(result, { ok: false, reason: "ambiguous_recipient" });
});

// ── 4. No valid recipient → blocked ─────────────────────────────────────────

test("zero active memberships: blocked as no active recipient", () => {
  const result = resolveRecipientFromActiveMemberships([]);
  assert.deepEqual(result, { ok: false, reason: "no_active_recipient" });
});

// ── 5. Consumer accounts never selected (structural) ────────────────────────

test("resolution is structurally scoped to operator_memberships only — getActiveOperatorMemberships never reads consumer_profiles", async () => {
  let queriedTable: string | null = null;
  const fakeAdmin = {
    from(table: string) {
      queriedTable = table;
      return {
        select() {
          return {
            eq() {
              return {
                eq: async () => ({ data: [], error: null }),
              };
            },
          };
        },
      };
    },
  };
  await getActiveOperatorMemberships("op-1", fakeAdmin as never);
  assert.equal(queriedTable, "operator_memberships");
});

// ── First-name derivation ────────────────────────────────────────────────────

test("first name is the first token of full_name", () => {
  const result = resolveRecipientFromActiveMemberships([{ role: "owner", email: "o@example.com", fullName: "Kelly Van Der Berg" }]);
  assert.equal(result.ok, true);
  assert.equal((result as { recipient: { firstName: string } }).recipient.firstName, "Kelly");
});

test("first name falls back to 'there' when full_name is null", () => {
  const result = resolveRecipientFromActiveMemberships([{ role: "owner", email: "o@example.com", fullName: null }]);
  assert.equal(result.ok, true);
  assert.equal((result as { recipient: { firstName: string } }).recipient.firstName, "there");
});

// ── Idempotent / deterministic ──────────────────────────────────────────────

test("resolution is deterministic — same input always produces the same outcome", () => {
  const memberships: ActiveMembershipLike[] = [{ role: "member", email: "solo@example.com", fullName: "Sam Solo" }];
  assert.deepEqual(resolveRecipientFromActiveMemberships(memberships), resolveRecipientFromActiveMemberships(memberships));
});

// ── Owner uniqueness (Correction Pass Section 3) ────────────────────────────
//
// operator_memberships has no schema-level "at most one owner" constraint
// (only UNIQUE(operator_id, email) — see recipientResolution.ts's module
// header for the full investigation). This resolver never arbitrarily
// picks "the first owner row" — it counts active owners explicitly.

test("exactly one active owner: used normally (unchanged happy path)", () => {
  const result = resolveRecipientFromActiveMemberships([{ role: "owner", email: "o@example.com", fullName: "Kelly Owner" }]);
  assert.deepEqual(result, { ok: true, recipient: { email: "o@example.com", firstName: "Kelly", role: "owner" } });
});

test("multiple active owners (not schema-enforced, but not arbitrarily resolved): blocked as ambiguous, never picks the first", () => {
  const memberships: ActiveMembershipLike[] = [
    { role: "owner", email: "first@example.com", fullName: "First Owner" },
    { role: "owner", email: "second@example.com", fullName: "Second Owner" },
  ];
  const result = resolveRecipientFromActiveMemberships(memberships);
  assert.deepEqual(result, { ok: false, reason: "ambiguous_recipient" });
});

test("multiple active owners plus active members: still ambiguous — owner count wins the branch, not membership count", () => {
  const memberships: ActiveMembershipLike[] = [
    { role: "owner", email: "first@example.com", fullName: "First Owner" },
    { role: "owner", email: "second@example.com", fullName: "Second Owner" },
    { role: "member", email: "m@example.com", fullName: "Member M" },
  ];
  const result = resolveRecipientFromActiveMemberships(memberships);
  assert.deepEqual(result, { ok: false, reason: "ambiguous_recipient" });
});

// ── Missing/blank recipient email (Correction Pass Section 4) ──────────────
//
// operator_memberships.email is NOT NULL at the schema level, but a
// blank/whitespace-only value is still defensively excluded — sending to
// an empty address must never happen regardless of role.

test("an owner with a blank email is treated as if no owner exists", () => {
  const memberships: ActiveMembershipLike[] = [{ role: "owner", email: "   ", fullName: "Kelly Owner" }];
  const result = resolveRecipientFromActiveMemberships(memberships);
  assert.deepEqual(result, { ok: false, reason: "no_active_recipient" });
});

test("a blank-email owner does not prevent falling back to a single valid member", () => {
  const memberships: ActiveMembershipLike[] = [
    { role: "owner", email: "", fullName: "Blank Owner" },
    { role: "member", email: "valid@example.com", fullName: "Valid Member" },
  ];
  const result = resolveRecipientFromActiveMemberships(memberships);
  assert.deepEqual(result, { ok: true, recipient: { email: "valid@example.com", firstName: "Valid", role: "member" } });
});
