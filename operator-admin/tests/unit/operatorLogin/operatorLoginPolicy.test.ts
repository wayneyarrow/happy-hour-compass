import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLoginNoteEventKey,
  buildLoginNoteText,
  buildLoginSlackText,
  formatPacificSignInTime,
  pacificLoginDate,
  resolvePasswordSignIn,
  SIGN_IN_FRESHNESS_MS,
} from "../../../src/lib/operatorLogin/operatorLoginPolicy";

const NOW = new Date("2026-10-05T17:00:00Z");
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

// ── What counts as a sign-in ────────────────────────────────────────────────

test("a fresh password sign-in resolves to its session id and the amr timestamp", () => {
  const signedAt = new Date(NOW.getTime() - 5_000);
  const result = resolvePasswordSignIn(
    { session_id: "sess-1", amr: [{ method: "password", timestamp: secs(signedAt) }] },
    NOW
  );
  assert.deepEqual(result, {
    ok: true,
    signIn: { sessionId: "sess-1", signedInAt: new Date(secs(signedAt) * 1000) },
  });
});

test("token refresh / restored session: same session but old password timestamp is rejected", () => {
  const old = new Date(NOW.getTime() - SIGN_IN_FRESHNESS_MS - 1_000);
  const result = resolvePasswordSignIn(
    { session_id: "sess-1", amr: [{ method: "password", timestamp: secs(old) }] },
    NOW
  );
  assert.deepEqual(result, { ok: false, reason: "stale_sign_in" });
});

test("setup / verification / password-reset sessions (otp, recovery, magiclink) are not sign-ins", () => {
  for (const method of ["otp", "recovery", "magiclink", "email/signup", "invite"]) {
    const result = resolvePasswordSignIn(
      { session_id: "sess-1", amr: [{ method, timestamp: secs(NOW) }] },
      NOW
    );
    assert.deepEqual(result, { ok: false, reason: "not_password_sign_in" }, method);
  }
});

test("missing session id, missing amr, or timestamp-less RFC amr are rejected", () => {
  assert.deepEqual(
    resolvePasswordSignIn({ amr: [{ method: "password", timestamp: secs(NOW) }] }, NOW),
    { ok: false, reason: "no_session_id" }
  );
  assert.deepEqual(resolvePasswordSignIn({ session_id: "s" }, NOW), {
    ok: false,
    reason: "not_password_sign_in",
  });
  assert.deepEqual(resolvePasswordSignIn({ session_id: "s", amr: ["password"] }, NOW), {
    ok: false,
    reason: "not_password_sign_in",
  });
});

test("a password timestamp far in the future is rejected; small skew is tolerated", () => {
  const skewed = new Date(NOW.getTime() + 30_000);
  assert.equal(
    resolvePasswordSignIn({ session_id: "s", amr: [{ method: "password", timestamp: secs(skewed) }] }, NOW).ok,
    true
  );
  const future = new Date(NOW.getTime() + 10 * 60_000);
  assert.deepEqual(
    resolvePasswordSignIn({ session_id: "s", amr: [{ method: "password", timestamp: secs(future) }] }, NOW),
    { ok: false, reason: "future_sign_in" }
  );
});

// ── Pacific day boundaries (DST-aware) ──────────────────────────────────────

test("Pacific date: PDT (UTC-7) midnight boundary", () => {
  assert.equal(pacificLoginDate(new Date("2026-07-15T06:59:59Z")), "2026-07-14");
  assert.equal(pacificLoginDate(new Date("2026-07-15T07:00:00Z")), "2026-07-15");
});

test("Pacific date: PST (UTC-8) midnight boundary", () => {
  assert.equal(pacificLoginDate(new Date("2026-12-15T07:59:59Z")), "2026-12-14");
  assert.equal(pacificLoginDate(new Date("2026-12-15T08:00:00Z")), "2026-12-15");
});

test("Pacific date: DST start (2026-03-08) and end (2026-11-01) days", () => {
  // Spring forward: 2026-03-08 begins at 08:00Z (PST), next day begins at 07:00Z (PDT).
  assert.equal(pacificLoginDate(new Date("2026-03-08T07:59:59Z")), "2026-03-07");
  assert.equal(pacificLoginDate(new Date("2026-03-08T08:00:00Z")), "2026-03-08");
  assert.equal(pacificLoginDate(new Date("2026-03-09T06:59:59Z")), "2026-03-08");
  assert.equal(pacificLoginDate(new Date("2026-03-09T07:00:00Z")), "2026-03-09");
  // Fall back: 2026-11-01 begins at 07:00Z (PDT), next day begins at 08:00Z (PST).
  assert.equal(pacificLoginDate(new Date("2026-11-01T06:59:59Z")), "2026-10-31");
  assert.equal(pacificLoginDate(new Date("2026-11-01T07:00:00Z")), "2026-11-01");
  assert.equal(pacificLoginDate(new Date("2026-11-02T07:59:59Z")), "2026-11-01");
  assert.equal(pacificLoginDate(new Date("2026-11-02T08:00:00Z")), "2026-11-02");
});

test("sign-in time is shown in Pacific with the right abbreviation", () => {
  assert.match(formatPacificSignInTime(new Date("2026-10-05T14:54:00Z")), /Oct 5, 2026, 7:54 AM PDT/);
  assert.match(formatPacificSignInTime(new Date("2026-12-05T15:54:00Z")), /Dec 5, 2026, 7:54 AM PST/);
});

// ── Note / Slack content ────────────────────────────────────────────────────

test("note key is per sign-in and per venue", () => {
  assert.equal(buildLoginNoteEventKey("sess-1", "venue-a"), "hhc-operator-login:sess-1:venue-a");
  assert.notEqual(buildLoginNoteEventKey("sess-1", "venue-a"), buildLoginNoteEventKey("sess-2", "venue-a"));
});

test("note text names the operator; falls back to email when no name", () => {
  assert.equal(
    buildLoginNoteText({ operatorName: "Kelly Terris", email: "kelly@example.com" }),
    "Operator logged in — Kelly Terris (kelly@example.com)"
  );
  assert.equal(buildLoginNoteText({ operatorName: "  ", email: "kelly@example.com" }), "Operator logged in — kelly@example.com");
});

test("Slack text lists every venue once, Pacific time, and Control Panel links; escapes names", () => {
  const text = buildLoginSlackText({
    operatorName: "Kelly Terris",
    email: "kelly@example.com",
    venues: [
      { id: "v1", name: "Buffalo Rouge" },
      { id: "v2", name: "Fish & Chips <Dock>" },
    ],
    signedInAt: new Date("2026-10-05T14:54:00Z"),
    siteUrl: "https://staging.happyhourcompass.com",
  });
  assert.match(text, /^🔑 \*Operator logged in\*/);
  assert.match(text, /\*Operator:\* Kelly Terris \(kelly@example\.com\)/);
  assert.match(text, /\*Venue\(s\):\* Buffalo Rouge, Fish &amp; Chips &lt;Dock&gt;/);
  assert.match(text, /\*Signed in:\* Oct 5, 2026, 7:54 AM PDT/);
  assert.match(text, /<https:\/\/staging\.happyhourcompass\.com\/control-panel\/venues\/v1\|Buffalo Rouge — Control Panel>/);
  assert.match(text, /control-panel\/venues\/v2\|/);
});

test("Slack and note text never contain credentials", () => {
  const text = buildLoginSlackText({
    operatorName: null,
    email: "a@b.com",
    venues: [{ id: "v1", name: "V" }],
    signedInAt: NOW,
    siteUrl: "https://x",
  });
  assert.doesNotMatch(text, /token|password|session/i);
});
