import { test, expect } from "./support/fixtures";

/**
 * Consumer signup lifecycle analytics (GA4) — consumer_signup_started,
 * consumer_signup_completed, consumer_email_confirmed.
 *
 * Scope note: this suite never completes the Cloudflare Turnstile widget or
 * submits the sign-up/confirm flows for real, matching the existing
 * account-entry.spec.ts precedent ("a disabled submit at this point is the
 * expected, safe state — we don't complete the challenge or submit, to
 * avoid creating a real account"). createConsumerAccount() is a Next.js
 * Server Action (not a stable REST endpoint like Supabase's own auth API),
 * so — unlike the sign-in error test's `**\/auth/v1/token**` mock — there is
 * no practical way to intercept it here either. That means the *positive*
 * "a genuine submission fires consumer_signup_started" case is not
 * exercisable end-to-end in this suite today; it's covered by source
 * inspection (see ga4.ts's doc comment and the final report) instead.
 *
 * What this file does verify end-to-end:
 *  - a client-validation failure never reaches the tracked call (negative
 *    case — no Turnstile/account-creation involved, so it's safe to submit).
 *  - plain page loads of /sign-up, /welcome, and /auth/confirm (with no
 *    confirmation token) push no GA4 event — gated behind a `gaActive`
 *    check, since NEXT_PUBLIC_GA_MEASUREMENT_ID is intentionally unset
 *    outside Production (see (website)/layout.tsx), so <GoogleAnalytics>
 *    never mounts here and window.dataLayer never exists. These tests
 *    self-skip with an explanatory message in that case rather than
 *    asserting something the environment can't produce either way.
 */

async function isGaActive(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => typeof (window as unknown as { dataLayer?: unknown[] }).dataLayer !== "undefined");
}

async function ga4EventNames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const dataLayer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
    // Each gtag('event', name, params) call lands in dataLayer as
    // IArguments-like {0: 'event', 1: name, 2: params}. Playwright's
    // page.evaluate serializes it as a plain array-like object.
    return dataLayer
      .map((entry) => (entry as Record<string, unknown>)?.[0] === "event" ? (entry as Record<string, unknown>)[1] : null)
      .filter((name): name is string => typeof name === "string");
  });
}

test.describe("Consumer signup analytics — negative / no-op cases", () => {
  test("a client-validation failure (password mismatch) never reaches the signup-attempt gate", async ({ page }) => {
    await page.goto("/sign-up");

    await page.getByLabel("Email").fill("audit-test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("Sup3rSecret!");
    await page.getByLabel("Confirm password").fill("DifferentPassword!");
    // Check both consent boxes so native HTML5 `required` constraint
    // validation doesn't block the submit before the app's own JS handler
    // ever runs — the thing under test is the app-level "passwords must
    // match" check inside handleSubmit, not native form validation.
    await page.getByRole("checkbox", { name: /terms of service/i }).check();
    await page.getByRole("checkbox", { name: /privacy policy/i }).check();

    // The submit button is disabled until Turnstile completes, and this
    // suite deliberately never completes Turnstile (see file header) — so a
    // real click() isn't available here. Trigger the native "submit" event
    // directly instead: requestSubmit() (unlike a disabled-button click or
    // Enter-key implicit submission) doesn't consult the disabled default
    // button, so it reaches the form's real onSubmit=handleSubmit exactly as
    // a real submit would, while still never touching Turnstile or the
    // network — handleSubmit's password-match check runs and returns before
    // either of those would ever be reached.
    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());

    // Validation error shown, submission never proceeded past client-side
    // checks — the button never enters its "Creating account…" loading
    // state, and the success ("Check your email") screen never appears.
    // Scoped by text: Next.js's own route-announcer live region also has
    // role="alert" (empty, for navigation announcements), so an unscoped
    // getByRole("alert") is ambiguous on this page.
    await expect(page.getByRole("alert").filter({ hasText: "Passwords do not match." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /check your email/i })).toHaveCount(0);

    const gaActive = await isGaActive(page);
    test.skip(!gaActive, "NEXT_PUBLIC_GA_MEASUREMENT_ID is unset in this environment (expected outside Production) — GA4 never mounts here, so this is verified via Preview DebugView QA instead (see final report).");
    expect(await ga4EventNames(page)).not.toContain("consumer_signup_started");
  });
});

test.describe("Consumer signup analytics — page views push no lifecycle event on their own", () => {
  test("/sign-up page load alone does not push consumer_signup_started", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/create your account/i);

    const gaActive = await isGaActive(page);
    test.skip(!gaActive, "GA4 not mounted in this environment — see note above.");
    expect(await ga4EventNames(page)).not.toContain("consumer_signup_started");
  });

  test("/welcome page load alone does not push consumer_email_confirmed", async ({ page }) => {
    // No session exists in this browser context, so /welcome redirects to
    // /sign-in — but that redirect itself is the point: an ordinary,
    // unauthenticated /welcome visit (bookmark, reload, back-navigation)
    // never reaches consumer_email_confirmed, which only ever fires from
    // auth/confirm's fresh-hash-token path, never from /welcome itself
    // (that page carries no GA4 tracking call at all).
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe("/welcome");

    const gaActive = await isGaActive(page);
    test.skip(!gaActive, "GA4 not mounted in this environment — see note above.");
    expect(await ga4EventNames(page)).not.toContain("consumer_email_confirmed");
  });

  test("/auth/confirm with no confirmation token shows the expired-link state and pushes no consumer_email_confirmed", async ({ page }) => {
    // No hash fragment, no active session: this is Path B falling through
    // to the "Link unavailable" fallback — the tracked call only lives
    // inside Path A's fresh-hash-token branch, which never executes here.
    await page.goto("/auth/confirm");
    await expect(page.getByRole("heading", { name: "Link unavailable" })).toBeVisible();

    const gaActive = await isGaActive(page);
    test.skip(!gaActive, "GA4 not mounted in this environment — see note above.");
    expect(await ga4EventNames(page)).not.toContain("consumer_email_confirmed");
  });
});
