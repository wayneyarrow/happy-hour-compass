import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reportOperationalError,
  sanitizeOperationalContext,
  type SentryCaptureClient,
  type SentryCaptureContext,
} from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { resolveSentryEnvironment } from "../../../src/lib/observability/sentryRuntime";

// ── Fake Sentry client ────────────────────────────────────────────────────────
//
// Mirrors the narrow-client-surface + dependency-injection pattern already
// used for Supabase fakes under tests/unit/google/support/ — no module
// mocking required.

type RecordedCapture = { exception: unknown; captureContext: SentryCaptureContext | undefined };

function createFakeSentryClient(options: { throwOnCapture?: boolean; eventId?: string } = {}): {
  client: SentryCaptureClient;
  calls: RecordedCapture[];
} {
  const calls: RecordedCapture[] = [];
  const client: SentryCaptureClient = {
    captureException(exception, captureContext) {
      calls.push({ exception, captureContext });
      if (options.throwOnCapture) {
        throw new Error("simulated Sentry SDK failure");
      }
      return options.eventId ?? "fake-sentry-event-id";
    },
  };
  return { client, calls };
}

// ── Basic capture behavior ──────────────────────────────────────────────────

test("reportOperationalError calls captureException exactly once", () => {
  const { client, calls } = createFakeSentryClient();

  reportOperationalError(
    { error: new Error("boom"), flow: "operator-submission", stage: "venue-insert", severity: "critical" },
    client
  );

  assert.equal(calls.length, 1);
});

test("reportOperationalError attaches the hhc_error_id tag, and it matches the returned reference", () => {
  const { client, calls } = createFakeSentryClient();

  const report = reportOperationalError(
    { error: new Error("boom"), flow: "operator-submission", stage: "venue-insert", severity: "critical" },
    client
  );

  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.equal(calls[0].captureContext?.tags?.hhc_error_id, report.hhcErrorId);
});

test("reportOperationalError attaches flow/stage/severity tags", () => {
  const { client, calls } = createFakeSentryClient();

  reportOperationalError(
    { error: new Error("boom"), flow: "claim-venue", stage: "claims-insert", severity: "operational" },
    client
  );

  const tags = calls[0].captureContext?.tags;
  assert.equal(tags?.flow, "claim-venue");
  assert.equal(tags?.stage, "claims-insert");
  assert.equal(tags?.severity, "operational");
});

test("reportOperationalError attaches an environment tag matching resolveSentryEnvironment(VERCEL_ENV)", () => {
  const { client, calls } = createFakeSentryClient();
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";

  try {
    const report = reportOperationalError(
      { error: new Error("boom"), flow: "claim-venue", stage: "claims-insert", severity: "warning" },
      client
    );

    assert.equal(report.environment, "preview");
    assert.equal(calls[0].captureContext?.tags?.environment, "preview");
    assert.equal(calls[0].captureContext?.tags?.environment, resolveSentryEnvironment(process.env.VERCEL_ENV));
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("reportOperationalError returns the sentryEventId the client produced", () => {
  const { client } = createFakeSentryClient({ eventId: "evt_abc123" });

  const report = reportOperationalError(
    { error: new Error("boom"), flow: "f", stage: "s", severity: "warning" },
    client
  );

  assert.equal(report.sentryEventId, "evt_abc123");
});

test("reportOperationalError's returned customerMessage embeds the same reference id", () => {
  const { client } = createFakeSentryClient();

  const report = reportOperationalError(
    { error: new Error("boom"), flow: "f", stage: "s", severity: "warning" },
    client
  );

  assert.ok(report.customerMessage.includes(report.hhcErrorId));
  assert.ok(report.customerMessage.includes("support@happyhourcompass.com"));
});

// ── Caller-supplied safe context ─────────────────────────────────────────────

test("reportOperationalError attaches caller-supplied safe context under hhc_context", () => {
  const { client, calls } = createFakeSentryClient();

  reportOperationalError(
    {
      error: new Error("boom"),
      flow: "operator-submission",
      stage: "venue-insert",
      severity: "critical",
      context: { matchStatus: "confirmed", routedStatus: "confirmed_auto", attempt: 2 },
    },
    client
  );

  const contexts = calls[0].captureContext?.contexts as Record<string, Record<string, unknown>> | undefined;
  assert.deepEqual(contexts?.hhc_context, {
    matchStatus: "confirmed",
    routedStatus: "confirmed_auto",
    attempt: 2,
  });
});

test("reportOperationalError omits contexts entirely when no context is supplied", () => {
  const { client, calls } = createFakeSentryClient();

  reportOperationalError(
    { error: new Error("boom"), flow: "f", stage: "s", severity: "warning" },
    client
  );

  assert.equal(calls[0].captureContext?.contexts, undefined);
});

// ── Never throws ─────────────────────────────────────────────────────────────

test("reportOperationalError does not throw when Sentry capture itself fails", () => {
  const { client } = createFakeSentryClient({ throwOnCapture: true });

  assert.doesNotThrow(() => {
    reportOperationalError(
      { error: new Error("boom"), flow: "f", stage: "s", severity: "critical" },
      client
    );
  });
});

test("when Sentry capture fails, sentryEventId is null but a reference/customerMessage are still returned", () => {
  const { client } = createFakeSentryClient({ throwOnCapture: true });

  const report = reportOperationalError(
    { error: new Error("boom"), flow: "f", stage: "s", severity: "critical" },
    client
  );

  assert.equal(report.sentryEventId, null);
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.ok(report.customerMessage.includes(report.hhcErrorId));
});

// ── Grouping / fingerprinting ────────────────────────────────────────────────

test("the random hhc_error_id is never used as the Sentry fingerprint — default grouping is preserved", () => {
  const { client, calls } = createFakeSentryClient();

  const report = reportOperationalError(
    { error: new Error("boom"), flow: "f", stage: "s", severity: "critical" },
    client
  );

  assert.equal(calls[0].captureContext?.fingerprint, undefined);
  // Also guard against a future change that smuggles it into the message.
  const exception = calls[0].exception as Error;
  assert.ok(!exception.message.includes(report.hhcErrorId));
});

test("two occurrences of literally the same underlying error still normalize to equal exception messages, only differing by their (untagged) reference id", () => {
  const { client, calls } = createFakeSentryClient();

  const dbError = { code: "23503", message: "insert or update on table venues violates foreign key constraint" };

  const first = reportOperationalError({ error: dbError, flow: "f", stage: "s", severity: "critical" }, client);
  const second = reportOperationalError({ error: dbError, flow: "f", stage: "s", severity: "critical" }, client);

  assert.notEqual(first.hhcErrorId, second.hhcErrorId);
  const firstMessage = (calls[0].exception as Error).message;
  const secondMessage = (calls[1].exception as Error).message;
  assert.equal(firstMessage, secondMessage); // identical — grouping key is untouched by the id
});

// ── Error normalization (non-Error inputs, e.g. Postgrest errors) ───────────

test("a plain object error (e.g. a Supabase/Postgrest error) is normalized into a real Error with its message preserved", () => {
  const { client, calls } = createFakeSentryClient();

  const postgrestError = {
    code: "23503",
    details: "Key (source_submission_id)=(...) is not present in table \"operator_submissions\".",
    hint: null,
    message: 'insert or update on table "venues" violates foreign key constraint "venues_source_submission_id_fk"',
  };

  reportOperationalError(
    { error: postgrestError, flow: "operator-submission", stage: "venue-insert", severity: "critical" },
    client
  );

  const captured = calls[0].exception;
  assert.ok(captured instanceof Error);
  assert.equal((captured as Error).message, postgrestError.message);
});

// ── sanitizeOperationalContext ───────────────────────────────────────────────

test("sanitizeOperationalContext drops keys that look like they hold sensitive data", () => {
  const clean = sanitizeOperationalContext({
    email: "someone@example.com",
    phone: "555-0100",
    authToken: "secret-token",
    apiKey: "sk_live_123",
    sessionCookie: "abc",
    streetAddress: "123 Main St",
    matchStatus: "confirmed", // safe, must survive
  });

  assert.deepEqual(clean, { matchStatus: "confirmed" });
});

test("sanitizeOperationalContext drops non-primitive values even if the type system is bypassed", () => {
  const clean = sanitizeOperationalContext({
    // @ts-expect-error — deliberately passing a non-primitive to prove the runtime guard
    user: { id: "u_123", name: "Someone" },
    safeCount: 3,
  });

  assert.deepEqual(clean, { safeCount: 3 });
});

test("sanitizeOperationalContext returns undefined for empty/undefined input", () => {
  assert.equal(sanitizeOperationalContext(undefined), undefined);
  assert.equal(sanitizeOperationalContext({}), undefined);
});

test("sanitizeOperationalContext returns undefined when every key was dropped", () => {
  assert.equal(sanitizeOperationalContext({ email: "a@b.com", token: "x" }), undefined);
});

// ── Personal-name fields (added: Consumer Signup observability hardening) ──

test("sanitizeOperationalContext drops personal first/last/full-name fields in every naming convention", () => {
  const clean = sanitizeOperationalContext({
    firstName: "Mindy",
    first_name: "Mindy",
    firstname: "Mindy",
    lastName: "Green",
    last_name: "Green",
    lastname: "Green",
    fullName: "Mindy Green",
    full_name: "Mindy Green",
    fullname: "Mindy Green",
    name: "Mindy Green",
    safeCount: 3, // must survive
  });

  assert.deepEqual(clean, { safeCount: 3 });
});

test("sanitizeOperationalContext still allows safe entity-name identifiers (venueName, businessName)", () => {
  const clean = sanitizeOperationalContext({
    venueName: "Casa de Frida",
    businessName: "BTS Cocktail Bar & Kitchen",
    displayName: "Mindy G.",
    userId: "u-123",
  });

  assert.deepEqual(clean, {
    venueName: "Casa de Frida",
    businessName: "BTS Cocktail Bar & Kitchen",
    displayName: "Mindy G.",
    userId: "u-123",
  });
});

test("sanitizeOperationalContext still catches ssn as its own token or with a delimiter, without breaking businessName", () => {
  const clean = sanitizeOperationalContext({
    ssn: "123-45-6789",
    consumer_ssn: "123-45-6789",
    businessName: "BTS Cocktail Bar & Kitchen", // must survive — the exact case this ssn fix exists for
  });

  assert.deepEqual(clean, { businessName: "BTS Cocktail Bar & Kitchen" });
});
