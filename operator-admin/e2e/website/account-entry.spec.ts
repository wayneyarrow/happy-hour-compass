import { test, expect } from "./support/fixtures";

test.describe("Consumer account entry points", () => {
  test("sign-up page loads with usable, fillable form controls", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/create your account/i);

    await page.getByLabel("Email").fill("audit-test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("Sup3rSecret!");
    await page.getByLabel("Confirm password").fill("Sup3rSecret!");

    // Turnstile gates the submit button until the widget completes — a
    // disabled submit at this point is the expected, safe state (we don't
    // complete the challenge or submit, to avoid creating a real account).
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("sign-in page loads with usable, fillable form controls", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/sign in/i);

    await page.getByLabel("Email").fill("audit-test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");

    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: /forgot your password/i })).toBeVisible();
  });

  test("forgot-password page loads with a usable, fillable form", async ({ page }) => {
    await page.goto("/account/forgot-password");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/reset your password/i);

    await page.getByLabel("Email").fill("audit-test@example.com");
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  });

  test("sign-in announces a general error via role=alert on failed credentials", async ({ page }) => {
    // Sign-in isn't Turnstile-gated, but it does call
    // supabase.auth.signInWithPassword directly from the browser — a real
    // network call we don't want to make in a test (side effects: auth
    // logs, rate-limit counters). Intercepting the Supabase token endpoint
    // exercises the actual error-rendering code path deterministically
    // without ever reaching the real backend.
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        // The real Supabase endpoint is a different origin from the app
        // (juphyhxdmcvseeufbiay.supabase.co vs. 127.0.0.1), and WebKit
        // enforces CORS on a fulfilled mock response the same as a real
        // one — without this header the fetch rejects as a CORS failure
        // instead of resolving with the body below, silently short-circuiting
        // the test (Chromium/Firefox are more lenient here).
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }),
      })
    );

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const alert = page.getByText("Invalid email or password.");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("role", "alert");
  });
});
