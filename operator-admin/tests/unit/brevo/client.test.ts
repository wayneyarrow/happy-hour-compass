import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertBrevoContact } from "../../../src/lib/brevo/client";
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
