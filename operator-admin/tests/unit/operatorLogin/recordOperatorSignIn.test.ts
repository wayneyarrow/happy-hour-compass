import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordOperatorSignIn,
  type OperatorSignInDeps,
  type LoginVenue,
  type ResolvedOperator,
  type VerifiedSession,
} from "../../../src/lib/operatorLogin/recordOperatorSignInImpl";
import type { SlackResult } from "../../../src/lib/slack";

/**
 * In-memory store with the same guarantees migration 106 gives the real one:
 * venue_notes.event_key is unique (duplicate → "duplicate"), and the Slack
 * day row is INSERT-wins with compare-and-swap takeover/mark/release. Each
 * method's check-and-write happens without an intervening await, so it is
 * atomic exactly like a single SQL statement.
 */
type SlackRow = { operatorId: string; claimedAt: string | null; sentAt: string | null; attempts: number; lastError: string | null };

function makeWorld(opts: {
  now: Date;
  operators?: Record<string, ResolvedOperator>; // by userId
  venues?: Record<string, LoginVenue[]>; // by operatorId
}) {
  const world = {
    now: opts.now,
    session: null as VerifiedSession | null,
    notes: new Map<string, { venueId: string; note: string; createdAt: string }>(),
    slackRows: new Map<string, SlackRow>(),
    slackSent: [] as string[],
    slackResult: "delivered" as SlackResult,
    noteInsertFails: false,
    venueLookupFails: false,
    deferred: [] as (() => Promise<unknown>)[],
    failures: [] as string[],
    resolveOperatorCalls: [] as { userId: string; email: string }[],
  };

  const deps: OperatorSignInDeps = {
    now: () => world.now,
    getVerifiedSession: async () => world.session,
    resolveOperator: async (s) => {
      world.resolveOperatorCalls.push(s);
      return opts.operators?.[s.userId] ?? null;
    },
    listOperatorVenues: async (operatorId) => (world.venueLookupFails ? null : opts.venues?.[operatorId] ?? []),
    insertLoginNote: async (row) => {
      if (world.noteInsertFails) return "error";
      if (world.notes.has(row.eventKey)) return "duplicate";
      world.notes.set(row.eventKey, { venueId: row.venueId, note: row.note, createdAt: row.createdAt });
      return "inserted";
    },
    claimSlackDay: async ({ authUserId, loginDate, operatorId, claimedAt, staleBefore }) => {
      const key = `${authUserId}:${loginDate}`;
      const row = world.slackRows.get(key);
      if (!row) {
        world.slackRows.set(key, { operatorId, claimedAt, sentAt: null, attempts: 1, lastError: null });
        return "claimed";
      }
      if (row.sentAt) return "taken";
      if (row.claimedAt && row.claimedAt >= staleBefore) return "taken";
      row.claimedAt = claimedAt;
      row.attempts += 1;
      return "claimed";
    },
    markSlackSent: async ({ authUserId, loginDate, claimedAt, sentAt }) => {
      const row = world.slackRows.get(`${authUserId}:${loginDate}`);
      if (!row || row.claimedAt !== claimedAt) return false;
      row.sentAt = sentAt;
      return true;
    },
    releaseSlackClaim: async ({ authUserId, loginDate, claimedAt, error }) => {
      const row = world.slackRows.get(`${authUserId}:${loginDate}`);
      if (!row || row.claimedAt !== claimedAt || row.sentAt) return false;
      row.claimedAt = null;
      row.lastError = error;
      return true;
    },
    sendSlack: async (text) => {
      await Promise.resolve(); // a real network hop — lets concurrent tasks interleave
      if (world.slackResult === "delivered") world.slackSent.push(text);
      return world.slackResult;
    },
    defer: (task) => {
      world.deferred.push(task);
    },
    reportFailure: async (title) => {
      world.failures.push(title);
    },
    siteUrl: () => "https://staging.happyhourcompass.com",
  };

  async function runDeferred() {
    const tasks = world.deferred.splice(0);
    await Promise.all(tasks.map((t) => t()));
  }

  return { world, deps, runDeferred };
}

const OWNER: ResolvedOperator = { operatorId: "op-1", name: "Kelly Terris" };
const VENUES: LoginVenue[] = [
  { id: "venue-a", name: "Buffalo Rouge" },
  { id: "venue-b", name: "Table 19" },
];

function signIn(world: { session: VerifiedSession | null }, sessionId: string, at: Date, userId = "user-1") {
  world.session = {
    userId,
    email: "kelly@example.com",
    claims: { session_id: sessionId, amr: [{ method: "password", timestamp: Math.floor(at.getTime() / 1000) }] },
  };
}

function setup(now = new Date("2026-10-05T17:00:00Z")) {
  return makeWorld({ now, operators: { "user-1": OWNER }, venues: { "op-1": VENUES } });
}

// ── Happy path / multi-venue ────────────────────────────────────────────────

test("sign-in creates one note per associated venue and exactly one Slack message", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", world.now);

  const result = await recordOperatorSignIn(deps);
  await runDeferred();

  assert.deepEqual(result, { status: "recorded", notes: { inserted: 2, duplicate: 0, failed: 0 }, slack: "scheduled" });
  assert.deepEqual([...world.notes.values()].map((n) => n.venueId).sort(), ["venue-a", "venue-b"]);
  for (const n of world.notes.values()) {
    assert.equal(n.note, "Operator logged in — Kelly Terris (kelly@example.com)");
    assert.equal(n.createdAt, new Date(Math.floor(world.now.getTime() / 1000) * 1000).toISOString());
  }
  assert.equal(world.slackSent.length, 1);
  assert.match(world.slackSent[0], /Buffalo Rouge, Table 19/);
  assert.equal(world.slackSent[0].match(/— Control Panel>/g)?.length, 2);
  assert.ok(world.slackRows.get("user-1:2026-10-05")?.sentAt);
});

test("note timestamp is the actual sign-in time (amr), not the processing time", async () => {
  const { world, deps } = setup();
  const signedAt = new Date(world.now.getTime() - 90_000);
  signIn(world, "sess-1", signedAt);
  await recordOperatorSignIn(deps);
  for (const n of world.notes.values()) assert.equal(n.createdAt, signedAt.toISOString());
});

// ── Daily Slack suppression ─────────────────────────────────────────────────

test("a second distinct sign-in the same Pacific day adds notes but no Slack message", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();

  world.now = new Date("2026-10-06T06:30:00Z"); // 11:30 PM PDT, still Oct 5
  signIn(world, "sess-2", world.now);
  const second = await recordOperatorSignIn(deps);
  await runDeferred();

  assert.equal(second.status, "recorded");
  assert.equal(world.notes.size, 4);
  assert.equal(world.slackSent.length, 1);
});

test("a sign-in on the next Pacific day is eligible for Slack again", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();

  world.now = new Date("2026-10-06T07:00:00Z"); // 12:00 AM PDT Oct 6
  signIn(world, "sess-2", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();

  assert.equal(world.slackSent.length, 2);
  assert.ok(world.slackRows.has("user-1:2026-10-06"));
});

test("the Slack day is taken from the sign-in time, even if the deferred send runs after midnight", async () => {
  const { world, deps, runDeferred } = setup(new Date("2026-10-06T06:59:30Z")); // 11:59:30 PM PDT Oct 5
  signIn(world, "sess-1", world.now);
  await recordOperatorSignIn(deps);
  world.now = new Date("2026-10-06T07:00:30Z");
  await runDeferred();
  assert.ok(world.slackRows.has("user-1:2026-10-05"));
  assert.ok(!world.slackRows.has("user-1:2026-10-06"));
});

test("DST fall-back day: 00:30 PDT and 23:30 PST on Nov 1 are the same Slack day", async () => {
  const { world, deps, runDeferred } = setup(new Date("2026-11-01T07:30:00Z"));
  signIn(world, "sess-1", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();
  world.now = new Date("2026-11-02T07:30:00Z"); // 11:30 PM PST, Nov 1
  signIn(world, "sess-2", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();
  assert.equal(world.slackSent.length, 1);
  assert.equal(world.notes.size, 4);
});

// ── Duplicate prevention ────────────────────────────────────────────────────

test("repeated calls for the same sign-in add no duplicate notes or Slack", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", world.now);
  await recordOperatorSignIn(deps);
  const again = await recordOperatorSignIn(deps);
  await runDeferred();

  assert.deepEqual(again, { status: "recorded", notes: { inserted: 0, duplicate: 2, failed: 0 }, slack: "scheduled" });
  assert.equal(world.notes.size, 2);
  assert.equal(world.slackSent.length, 1);
});

test("concurrent processing of the same sign-in yields one note per venue and one Slack message", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", world.now);
  await Promise.all(Array.from({ length: 5 }, () => recordOperatorSignIn(deps)));
  await runDeferred(); // five deferred sends race for the same day claim

  assert.equal(world.notes.size, 2);
  assert.equal(world.slackSent.length, 1);
});

test("concurrent distinct sign-ins the same day: all notes, one Slack message", async () => {
  const { world, deps, runDeferred } = setup();
  const sessions = ["s1", "s2", "s3"];
  await Promise.all(
    sessions.map(async (s) => {
      signIn(world, s, world.now);
      const session = world.session;
      return recordOperatorSignIn({ ...deps, getVerifiedSession: async () => session });
    })
  );
  await runDeferred();
  assert.equal(world.notes.size, 6);
  assert.equal(world.slackSent.length, 1);
});

// ── Not a sign-in ───────────────────────────────────────────────────────────

test("no session (failed login) records nothing", async () => {
  const { world, deps, runDeferred } = setup();
  world.session = null;
  assert.deepEqual(await recordOperatorSignIn(deps), { status: "skipped", reason: "no_session" });
  await runDeferred();
  assert.equal(world.notes.size, 0);
  assert.equal(world.slackSent.length, 0);
});

test("page refresh / restored session / token refresh (old amr) records nothing", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", new Date(world.now.getTime() - 60 * 60_000));
  assert.deepEqual(await recordOperatorSignIn(deps), { status: "skipped", reason: "stale_sign_in" });
  await runDeferred();
  assert.equal(world.notes.size, 0);
  assert.equal(world.slackSent.length, 0);
  assert.equal(world.resolveOperatorCalls.length, 0);
});

test("setup / verification / password-reset sessions record nothing", async () => {
  const { world, deps, runDeferred } = setup();
  for (const method of ["otp", "recovery"]) {
    world.session = {
      userId: "user-1",
      email: "kelly@example.com",
      claims: { session_id: `sess-${method}`, amr: [{ method, timestamp: Math.floor(world.now.getTime() / 1000) }] },
    };
    assert.deepEqual(await recordOperatorSignIn(deps), { status: "skipped", reason: "not_password_sign_in" });
  }
  await runDeferred();
  assert.equal(world.notes.size, 0);
  assert.equal(world.slackSent.length, 0);
});

// ── Who gets entries ────────────────────────────────────────────────────────

test("a non-operator (consumer) records nothing", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", world.now, "consumer-user");
  assert.deepEqual(await recordOperatorSignIn(deps), { status: "skipped", reason: "not_operator" });
  await runDeferred();
  assert.equal(world.notes.size, 0);
  assert.equal(world.slackSent.length, 0);
});

test("an operator with no associated venue gets no notes and no Slack", async () => {
  const { world, deps, runDeferred } = makeWorld({
    now: new Date("2026-10-05T17:00:00Z"),
    operators: { "user-1": OWNER },
    venues: {},
  });
  signIn(world, "sess-1", world.now);
  assert.deepEqual(await recordOperatorSignIn(deps), { status: "skipped", reason: "no_venues" });
  await runDeferred();
  assert.equal(world.slackRows.size, 0);
  assert.equal(world.slackSent.length, 0);
});

test("identity comes only from the verified session — the operator is resolved from its user id/email", async () => {
  const { world, deps } = setup();
  signIn(world, "sess-1", world.now, "user-1");
  await recordOperatorSignIn(deps);
  assert.deepEqual(world.resolveOperatorCalls, [{ userId: "user-1", email: "kelly@example.com" }]);
  // recordOperatorSignIn takes no client input at all.
  assert.equal(recordOperatorSignIn.length, 1);
});

// ── Failure handling ────────────────────────────────────────────────────────

test("Slack failure: not marked sent, failure reported, and a later sign-in that day retries", async () => {
  const { world, deps, runDeferred } = setup();
  world.slackResult = "failed";
  signIn(world, "sess-1", world.now);
  const result = await recordOperatorSignIn(deps);
  await runDeferred();

  assert.equal(result.status, "recorded");
  const row = world.slackRows.get("user-1:2026-10-05")!;
  assert.equal(row.sentAt, null);
  assert.equal(row.claimedAt, null);
  assert.equal(row.lastError, "Slack delivery failed");
  assert.ok(world.failures.some((f) => /Slack delivery failed/.test(f)));

  world.slackResult = "delivered";
  world.now = new Date(world.now.getTime() + 60_000);
  signIn(world, "sess-2", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();
  assert.equal(world.slackSent.length, 1);
  assert.equal(world.slackRows.get("user-1:2026-10-05")!.attempts, 2);
});

test("missing webhook is never recorded as sent", async () => {
  const { world, deps, runDeferred } = setup();
  world.slackResult = "no-webhook";
  signIn(world, "sess-1", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();
  assert.equal(world.slackRows.get("user-1:2026-10-05")!.sentAt, null);
});

test("a claim held by a request that died mid-send is taken over only once stale", async () => {
  const { world, deps, runDeferred } = setup();
  world.slackRows.set("user-1:2026-10-05", {
    operatorId: "op-1",
    claimedAt: new Date(world.now.getTime() - 30_000).toISOString(),
    sentAt: null,
    attempts: 1,
    lastError: null,
  });
  signIn(world, "sess-1", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();
  assert.equal(world.slackSent.length, 0, "fresh claim — still owned by its holder");

  world.now = new Date(world.now.getTime() + 3 * 60_000);
  signIn(world, "sess-2", world.now);
  await recordOperatorSignIn(deps);
  await runDeferred();
  assert.equal(world.slackSent.length, 1, "stale claim — taken over");
});

test("timeline failure is reported, Slack still scheduled, and nothing throws", async () => {
  const { world, deps, runDeferred } = setup();
  world.noteInsertFails = true;
  signIn(world, "sess-1", world.now);
  const result = await recordOperatorSignIn(deps);
  await runDeferred();
  assert.deepEqual(result, { status: "recorded", notes: { inserted: 0, duplicate: 0, failed: 2 }, slack: "scheduled" });
  assert.ok(world.failures.some((f) => /Internal Note failed/.test(f)));
  assert.equal(world.slackSent.length, 1);
});

test("venue lookup failure is reported and records nothing", async () => {
  const { world, deps } = setup();
  world.venueLookupFails = true;
  signIn(world, "sess-1", world.now);
  assert.deepEqual(await recordOperatorSignIn(deps), { status: "skipped", reason: "venue_lookup_failed" });
  assert.ok(world.failures.length === 1);
});

test("thrown dependency errors are swallowed (sign-in unaffected)", async () => {
  const { world, deps, runDeferred } = setup();
  signIn(world, "sess-1", world.now);
  const throwing: OperatorSignInDeps = {
    ...deps,
    insertLoginNote: async () => {
      throw new Error("db down");
    },
    sendSlack: async () => {
      throw new Error("network");
    },
  };
  assert.deepEqual(await recordOperatorSignIn(throwing), { status: "skipped", reason: "unexpected_error" });

  const slackThrows: OperatorSignInDeps = { ...deps, sendSlack: async () => { throw new Error("network"); } };
  signIn(world, "sess-2", world.now);
  await recordOperatorSignIn(slackThrows);
  await assert.doesNotReject(runDeferred());
  assert.equal(world.slackRows.get("user-1:2026-10-05")!.sentAt, null);
});
