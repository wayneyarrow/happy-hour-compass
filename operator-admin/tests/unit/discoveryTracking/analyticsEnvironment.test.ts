import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAnalyticsEnvironment } from "../../../src/lib/analyticsEnvironment";

/**
 * Verified Vercel setup (2026-10-10, `vercel inspect`): Production = main
 * (happyhourcompass.com …); every Preview is the `website` branch aliased to
 * staging.happyhourcompass.com. VERCEL_ENV alone can't tell staging from
 * another preview, so the git branch is part of the rule.
 */
test("production deployment → production", () => {
  assert.equal(resolveAnalyticsEnvironment({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" } as unknown as NodeJS.ProcessEnv), "production");
});

test("preview built from the website branch → staging", () => {
  assert.equal(resolveAnalyticsEnvironment({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "website" } as unknown as NodeJS.ProcessEnv), "staging");
});

test("any other preview (other branch, CLI deploy without a ref) → preview, never staging or production", () => {
  assert.equal(resolveAnalyticsEnvironment({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature-x" } as unknown as NodeJS.ProcessEnv), "preview");
  assert.equal(resolveAnalyticsEnvironment({ VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv), "preview");
});

test("not on Vercel (local dev against the shared DB, scripts) → development, never production", () => {
  assert.equal(resolveAnalyticsEnvironment({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), "development");
  assert.equal(resolveAnalyticsEnvironment({} as unknown as NodeJS.ProcessEnv), "development");
  assert.equal(resolveAnalyticsEnvironment({ VERCEL_ENV: "development" } as unknown as NodeJS.ProcessEnv), "development");
});
