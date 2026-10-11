import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveControlPanelAccess } from "../../../src/lib/requireControlPanelAdmin";

/**
 * The authorization decision every Control Panel page and the layout run
 * first (requireControlPanelAdmin). Eligibility is delegated to
 * isControlPanelAdmin(); here it's injected so each outcome is exercised.
 */

const admin = async () => true;
const notAdmin = async () => false;

test("logged out → /control-panel-login, eligibility never consulted", async () => {
  let consulted = false;
  const r = await resolveControlPanelAccess({ getUser: async () => null, isAdmin: async () => ((consulted = true), true) });
  assert.deepEqual(r, { ok: false, reason: "no_session", redirectTo: "/control-panel-login" });
  assert.equal(consulted, false);
});

test("session without an email → /control-panel-login", async () => {
  const r = await resolveControlPanelAccess({ getUser: async () => ({ id: "u1", email: null }), isAdmin: admin });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.redirectTo, "/control-panel-login");
});

test("signed-in non-admin → / (never the Control Panel)", async () => {
  const r = await resolveControlPanelAccess({ getUser: async () => ({ id: "u2", email: "someone@example.com" }), isAdmin: notAdmin });
  assert.deepEqual(r, { ok: false, reason: "not_admin", redirectTo: "/" });
});

test("fails closed: a session lookup error is not authorized", async () => {
  const r = await resolveControlPanelAccess({ getUser: async () => { throw new Error("auth down"); }, isAdmin: admin });
  assert.deepEqual(r, { ok: false, reason: "error", redirectTo: "/control-panel-login" });
});

test("fails closed: an eligibility-check error is not authorized", async () => {
  const r = await resolveControlPanelAccess({
    getUser: async () => ({ id: "u3", email: "founder@example.com" }),
    isAdmin: async () => { throw new Error("db down"); },
  });
  assert.deepEqual(r, { ok: false, reason: "error", redirectTo: "/" });
});

test("a valid admin is allowed, with the email passed to the existing eligibility check", async () => {
  let checked = "";
  const r = await resolveControlPanelAccess({
    getUser: async () => ({ id: "u4", email: "founder@example.com" }),
    isAdmin: async (email) => ((checked = email), true),
  });
  assert.deepEqual(r, { ok: true, admin: { userId: "u4", email: "founder@example.com" } });
  assert.equal(checked, "founder@example.com");
});
