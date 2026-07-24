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
});
