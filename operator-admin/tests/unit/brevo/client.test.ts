import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertBrevoContact, removeBrevoContactFromList } from "../../../src/lib/brevo/client";
import { BrevoApiError } from "../../../src/lib/brevo/errors";
import { BrevoConfigError } from "../../../src/lib/brevo/config";
import { BrevoStagingGuardBlockedError } from "../../../src/lib/brevo/stagingGuard";
import { withBrevoEnv } from "./support/testEnv";

type FetchCall = { url: string; init: RequestInit };

function installFakeFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("throws BrevoConfigError (and never calls fetch) when config is missing", async () => {
  const restoreEnv = withBrevoEnv({});
  const fake = installFakeFetch(() => new Response(null, { status: 200 }));
  try {
    await assert.rejects(
      () => upsertBrevoContact({ email: "wayne@example.com", listId: 2 }),
      BrevoConfigError
    );
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("throws BrevoStagingGuardBlockedError (and never calls fetch) for a non-allowlisted email", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@example.com",
  });
  const fake = installFakeFetch(() => new Response(null, { status: 200 }));
  try {
    await assert.rejects(
      () => upsertBrevoContact({ email: "someone-else@example.com", listId: 3 }),
      BrevoStagingGuardBlockedError
    );
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("succeeds for the allowlisted test email and sends the expected request shape", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@example.com",
  });
  const fake = installFakeFetch(() => new Response(null, { status: 204 }));
  try {
    await upsertBrevoContact({
      email: "wayne@example.com",
      attributes: { FIRSTNAME: "Wayne" },
      listId: 3,
    });

    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.url, "https://api.brevo.com/v3/contacts");
    assert.equal(call.init.method, "POST");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["api-key"], "fake-key");
    const body = JSON.parse(call.init.body as string);
    assert.equal(body.email, "wayne@example.com");
    assert.deepEqual(body.listIds, [3]);
    assert.equal(body.updateEnabled, true);
    assert.equal(body.attributes.FIRSTNAME, "Wayne");
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("production path (no BREVO_TEST_EMAIL) allows any email through to fetch", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response(null, { status: 201 }));
  try {
    await upsertBrevoContact({ email: "any-consumer@example.com", listId: 2 });
    assert.equal(fake.calls.length, 1);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("classifies a 400 response as invalid_request", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ code: "invalid_parameter", message: "bad email" }), { status: 400 })
  );
  try {
    await assert.rejects(
      () => upsertBrevoContact({ email: "bad@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "invalid_request");
        assert.equal(err.status, 400);
        assert.equal(err.brevoCode, "invalid_parameter");
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("classifies a 401 response as auth", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response(JSON.stringify({ message: "invalid key" }), { status: 401 }));
  try {
    await assert.rejects(
      () => upsertBrevoContact({ email: "wayne@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "auth");
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("classifies a 429 response as transient", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response(JSON.stringify({ message: "too many requests" }), { status: 429 }));
  try {
    await assert.rejects(
      () => upsertBrevoContact({ email: "wayne@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "transient");
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("classifies a 500 response as transient", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response("internal error", { status: 500 }));
  try {
    await assert.rejects(
      () => upsertBrevoContact({ email: "wayne@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "transient");
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("classifies a network failure as transient", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => upsertBrevoContact({ email: "wayne@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "transient");
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
    restoreEnv();
  }
});

test("error messages never contain the raw API key", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "super-secret-key-value", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response(JSON.stringify({ message: "invalid key" }), { status: 401 }));
  try {
    try {
      await upsertBrevoContact({ email: "wayne@example.com", listId: 2 });
      assert.fail("expected upsertBrevoContact to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(!message.includes("super-secret-key-value"));
    }
  } finally {
    fake.restore();
    restoreEnv();
  }
});

// ── removeBrevoContactFromList (subscribed:false path) ─────────────────────

test("removeBrevoContactFromList throws BrevoConfigError (and never calls fetch) when config is missing", async () => {
  const restoreEnv = withBrevoEnv({});
  const fake = installFakeFetch(() => new Response(null, { status: 201 }));
  try {
    await assert.rejects(
      () => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }),
      BrevoConfigError
    );
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList throws BrevoStagingGuardBlockedError (and never calls fetch) for a non-allowlisted email", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@example.com",
  });
  const fake = installFakeFetch(() => new Response(null, { status: 201 }));
  try {
    await assert.rejects(
      () => removeBrevoContactFromList({ email: "someone-else@example.com", listId: 3 }),
      BrevoStagingGuardBlockedError
    );
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList sends the expected list-scoped removal request", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response(JSON.stringify({ contacts: { success: [], failure: [] } }), { status: 201 }));
  try {
    await removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 });

    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.url, "https://api.brevo.com/v3/contacts/lists/2/contacts/remove");
    assert.equal(call.init.method, "POST");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["api-key"], "fake-key");
    const body = JSON.parse(call.init.body as string);
    assert.deepEqual(body, { emails: ["wayne@example.com"] });
  } finally {
    fake.restore();
    restoreEnv();
  }
});

// NOTE: Brevo's documented response schema for contacts.success/failure is
// PLAIN ARRAYS OF THE REQUESTED IDENTIFIER (email strings here) — not
// objects with a reason/code/message field (confirmed against the official
// API reference; an earlier version of this test assumed an undocumented
// object shape with a "reason" field and asserted the opposite of the
// behavior below — that assumption was wrong and has been corrected here).

test("removeBrevoContactFromList treats the requested email appearing in contacts.success as success", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ contacts: { success: ["wayne@example.com"], failure: [] } }), { status: 201 })
  );
  try {
    await assert.doesNotReject(() => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }));
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList does NOT silently treat the requested email appearing in contacts.failure as success", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  // Per Brevo's documented schema, contacts.failure is a plain array of the
  // requested email(s) — with no further detail distinguishing "already
  // absent" from a genuine failure. Per the conservative, documented-safe
  // design, this must surface as an error, not be assumed harmless.
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ contacts: { success: [], failure: ["wayne@example.com"] } }), { status: 201 })
  );
  try {
    await assert.rejects(
      () => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "unknown"); // retryable — see errors.ts isRetryable()
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList is case-insensitive when matching the requested email against contacts.failure", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ contacts: { success: [], failure: ["Wayne@Example.com"] } }), { status: 201 })
  );
  try {
    await assert.rejects(() => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }), BrevoApiError);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList does not throw when the failure array contains a different, unrelated email", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ contacts: { success: [], failure: ["someone-else@example.com"] } }), { status: 201 })
  );
  try {
    await assert.doesNotReject(() => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }));
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList treats an unparseable 2xx body as success (no failure array to check)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response(null, { status: 201 }));
  try {
    await assert.doesNotReject(() => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }));
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList classifies a 400 response as invalid_request", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ code: "invalid_parameter", message: "bad list" }), { status: 400 })
  );
  try {
    await assert.rejects(
      () => removeBrevoContactFromList({ email: "wayne@example.com", listId: 999 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "invalid_request");
        assert.equal(err.status, 400);
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList classifies a network failure as transient", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "transient");
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
    restoreEnv();
  }
});

test("removeBrevoContactFromList never sends contact attributes (list-removal request shape has no attributes field)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(() => new Response(null, { status: 201 }));
  try {
    await removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 });
    const body = JSON.parse(fake.calls[0].init.body as string);
    assert.equal("attributes" in body, false);
    assert.equal("updateEnabled" in body, false);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

// ── Already-absent idempotency fix (real staging QA finding, 2026-08-20) ───
// Real Brevo behavior for an already-absent contact is HTTP 400 with the
// exact message "Contact already removed from list and/or does not exist"
// — not the documented 2xx-with-contacts.failure shape. Confirmed via
// controlled QA against the allowlisted staging test identity.

test("removeBrevoContactFromList treats Brevo's real already-absent HTTP 400 response as success", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () =>
      new Response(
        JSON.stringify({ code: "invalid_parameter", message: "Contact already removed from list and/or does not exist" }),
        { status: 400 }
      )
  );
  try {
    await assert.doesNotReject(() => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }));
    assert.equal(fake.calls.length, 1, "still makes exactly one request — no extra API call added");
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList is case-insensitive when matching the already-absent message", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ message: "CONTACT ALREADY REMOVED FROM LIST and/or does not exist" }), { status: 400 })
  );
  try {
    await assert.doesNotReject(() => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }));
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList does NOT treat an unrelated HTTP 400 as success — genuine 400 errors still surface", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ code: "invalid_parameter", message: "listId is not a valid number" }), { status: 400 })
  );
  try {
    await assert.rejects(
      () => removeBrevoContactFromList({ email: "wayne@example.com", listId: 999 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "invalid_request");
        assert.equal(err.status, 400);
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList does NOT treat this message on a different status code (e.g. 500) as success", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ message: "Contact already removed from list and/or does not exist" }), { status: 500 })
  );
  try {
    await assert.rejects(
      () => removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof BrevoApiError);
        assert.equal(err.errorClass, "transient"); // 5xx — still retryable, unaffected by the narrow 400 exception
        return true;
      }
    );
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("removeBrevoContactFromList's already-absent handling never calls the contact-delete endpoint", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ message: "Contact already removed from list and/or does not exist" }), { status: 400 })
  );
  try {
    await removeBrevoContactFromList({ email: "wayne@example.com", listId: 2 });
    assert.equal(fake.calls.length, 1);
    assert.match(fake.calls[0].url, /\/contacts\/lists\/2\/contacts\/remove$/);
    assert.doesNotMatch(fake.calls[0].url, /DELETE/i);
    assert.notEqual(fake.calls[0].init.method, "DELETE");
  } finally {
    fake.restore();
    restoreEnv();
  }
});
