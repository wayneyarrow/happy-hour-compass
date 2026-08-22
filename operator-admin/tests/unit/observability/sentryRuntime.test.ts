import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSentryEnvironment,
  resolveSentryRelease,
} from "../../../src/lib/observability/sentryRuntime";

// ── Environment ──────────────────────────────────────────────────────────────

test("resolveSentryEnvironment maps VERCEL_ENV=production to production", () => {
  assert.equal(resolveSentryEnvironment("production"), "production");
});

test("resolveSentryEnvironment maps VERCEL_ENV=preview to preview (never production)", () => {
  assert.equal(resolveSentryEnvironment("preview"), "preview");
});

test("resolveSentryEnvironment maps VERCEL_ENV=development to development", () => {
  assert.equal(resolveSentryEnvironment("development"), "development");
});

test("resolveSentryEnvironment falls back to development when VERCEL_ENV is undefined (plain local dev)", () => {
  assert.equal(resolveSentryEnvironment(undefined), "development");
});

test("resolveSentryEnvironment falls back to development for an empty string (next.config.ts's local fallback)", () => {
  assert.equal(resolveSentryEnvironment(""), "development");
});

test("resolveSentryEnvironment never labels an unrecognized value as production — the core regression this fixes", () => {
  // Guards against ever reintroducing the NODE_ENV bug this replaces:
  // NODE_ENV is "production" for every `next build`, including Preview.
  // Anything unrecognized must resolve to "development", not "production".
  assert.equal(resolveSentryEnvironment("production-ish"), "development");
  assert.equal(resolveSentryEnvironment("staging"), "development");
  assert.equal(resolveSentryEnvironment("PRODUCTION"), "development"); // case-sensitive on purpose
});

// ── Release ──────────────────────────────────────────────────────────────────

test("resolveSentryRelease returns the git SHA when present", () => {
  const sha = "a84ed4be1de1ec626998117fd1f4840161e3728e";
  assert.equal(resolveSentryRelease(sha), sha);
});

test("resolveSentryRelease returns undefined when the SHA is absent (local dev)", () => {
  assert.equal(resolveSentryRelease(undefined), undefined);
});

test("resolveSentryRelease returns undefined for an empty string (next.config.ts's local fallback)", () => {
  assert.equal(resolveSentryRelease(""), undefined);
});

test("resolveSentryRelease never invents a fallback version number", () => {
  const result = resolveSentryRelease(undefined);
  assert.equal(typeof result, "undefined");
});
