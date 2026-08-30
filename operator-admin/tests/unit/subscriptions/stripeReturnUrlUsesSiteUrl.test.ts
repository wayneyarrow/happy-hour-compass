import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSiteUrl } from "../../../src/lib/siteUrl";

/**
 * Regression coverage for the staging redirect-host defect found during
 * Phase 2B hosted staging QA: createCheckoutSessionAction/
 * createPortalSessionAction (src/app/admin/subscription/stripeActions.ts)
 * used to build their success_url/cancel_url/return_url via a locally-
 * duplicated getAppUrl(), which fell back to the raw per-deployment
 * VERCEL_URL on Preview instead of the branch-configured
 * NEXT_PUBLIC_SITE_URL (staging.happyhourcompass.com) — the operator's
 * session cookie, scoped to the stable custom domain, didn't apply on that
 * other host, so returning from Stripe landed on /login instead of
 * /admin/subscription.
 *
 * The fix reuses the existing shared getSiteUrl() helper (src/lib/siteUrl.ts)
 * — exactly the same fix already applied once before to src/lib/email.ts for
 * an identical bug (see that file's header comment) — rather than maintaining
 * a second, independent environment-resolution function.
 *
 * getSiteUrl() itself has no DI seam issue (it's a pure function reading
 * process.env at call time, no Supabase/Stripe SDK involved) so its
 * environment-priority behavior is tested here directly and executably,
 * not just via static source-text assertions.
 */

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("website Preview/staging with NEXT_PUBLIC_SITE_URL set resolves to the canonical staging domain", () => {
  withEnv(
    {
      NEXT_PUBLIC_SITE_URL: "https://staging.happyhourcompass.com",
      VERCEL_ENV: "preview",
      VERCEL_URL: "happy-hour-compass-abc123-waynes-projects.vercel.app",
    },
    () => {
      assert.equal(getSiteUrl(), "https://staging.happyhourcompass.com");
    }
  );
});

test("raw VERCEL_URL never overrides the canonical staging URL when NEXT_PUBLIC_SITE_URL is set", () => {
  withEnv(
    {
      NEXT_PUBLIC_SITE_URL: "https://staging.happyhourcompass.com",
      VERCEL_ENV: "preview",
      VERCEL_URL: "happy-hour-compass-some-other-deploy-hash.vercel.app",
    },
    () => {
      const url = getSiteUrl();
      assert.ok(!url.includes("vercel.app"), `expected no raw vercel.app host, got ${url}`);
      assert.equal(url, "https://staging.happyhourcompass.com");
    }
  );
});

test("production (VERCEL_ENV=production, no explicit override) resolves to the production hostname", () => {
  withEnv(
    { NEXT_PUBLIC_SITE_URL: undefined, VERCEL_ENV: "production", VERCEL_URL: "happy-hour-compass.vercel.app" },
    () => {
      assert.equal(getSiteUrl(), "https://happyhourcompass.com");
    }
  );
});

test("local development (no Vercel env vars at all) falls back to localhost", () => {
  withEnv(
    { NEXT_PUBLIC_SITE_URL: undefined, VERCEL_ENV: undefined, VERCEL_URL: undefined },
    () => {
      assert.equal(getSiteUrl(), "http://localhost:3000");
    }
  );
});

test("a Preview deployment with no explicit NEXT_PUBLIC_SITE_URL override still falls back to VERCEL_URL (unattended preview builds, e.g. PR previews)", () => {
  withEnv(
    { NEXT_PUBLIC_SITE_URL: undefined, VERCEL_ENV: "preview", VERCEL_URL: "happy-hour-compass-git-some-pr-waynes-projects.vercel.app" },
    () => {
      assert.equal(getSiteUrl(), "https://happy-hour-compass-git-some-pr-waynes-projects.vercel.app");
    }
  );
});

// ── Static source coverage — stripeActions.ts must actually call getSiteUrl(),
// not a locally-duplicated equivalent ──────────────────────────────────────

const STRIPE_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/subscription/stripeActions.ts"),
  "utf8"
);

test("stripeActions.ts imports and uses the shared getSiteUrl() helper", () => {
  assert.match(STRIPE_ACTIONS_SOURCE, /import\s*\{\s*getSiteUrl\s*\}\s*from\s*"@\/lib\/siteUrl"/);
  assert.match(STRIPE_ACTIONS_SOURCE, /getSiteUrl\(\)/);
});

test("stripeActions.ts no longer defines or calls a locally-duplicated getAppUrl()", () => {
  assert.doesNotMatch(STRIPE_ACTIONS_SOURCE, /function getAppUrl/);
  assert.doesNotMatch(STRIPE_ACTIONS_SOURCE, /getAppUrl\(/);
});

test("stripeActions.ts no longer reads APP_URL or VERCEL_URL directly — only through getSiteUrl()", () => {
  assert.doesNotMatch(STRIPE_ACTIONS_SOURCE, /process\.env\.APP_URL/);
  assert.doesNotMatch(STRIPE_ACTIONS_SOURCE, /process\.env\.VERCEL_URL/);
});

test("Checkout success_url and cancel_url are both built from the getSiteUrl()-derived base", () => {
  const checkoutBlock = STRIPE_ACTIONS_SOURCE.slice(
    STRIPE_ACTIONS_SOURCE.indexOf("stripe.checkout.sessions.create"),
    STRIPE_ACTIONS_SOURCE.indexOf("subscription_data:")
  );
  assert.match(checkoutBlock, /success_url:\s*`\$\{appUrl\}\/admin\/subscription\?checkout=success`/);
  assert.match(checkoutBlock, /cancel_url:\s*`\$\{appUrl\}\/admin\/subscription`/);
});

test("Customer Portal return_url is built from the same getSiteUrl()-derived base", () => {
  const portalBlock = STRIPE_ACTIONS_SOURCE.slice(STRIPE_ACTIONS_SOURCE.indexOf("createPortalSessionAction"));
  assert.match(portalBlock, /const appUrl = getSiteUrl\(\);/);
  assert.match(portalBlock, /return_url:\s*`\$\{appUrl\}\/admin\/subscription`/);
});
