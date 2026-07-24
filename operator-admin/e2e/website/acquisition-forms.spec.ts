import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

/** Opens a header-triggered modal, going through the mobile hamburger menu on narrow viewports. */
async function openHeaderTrigger(page: Page, label: string) {
  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 0) < 768;
  if (isMobile) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }
  await page.getByRole("button", { name: label, exact: true }).click();
}

test.describe("Acquisition forms — open without submitting", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Suggest a Venue modal opens with a usable form", async ({ page }) => {
    await openHeaderTrigger(page, "Suggest a Venue");
    const dialog = page.getByRole("dialog", { name: "Suggest a Venue" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Business name").fill("Audit Test Venue");
    await dialog.getByLabel("City").fill("Kelowna");
    await expect(dialog.getByRole("button", { name: /submit suggestion/i })).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("Add Your Venue modal opens with a usable form", async ({ page }) => {
    await openHeaderTrigger(page, "Add Your Venue");
    const dialog = page.getByRole("dialog", { name: "Add Your Venue" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Business name").fill("Audit Test Venue");
    await expect(dialog.getByRole("button", { name: /find my business/i })).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("Contact Us modal opens from the footer with a usable form", async ({ page }) => {
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    await footer.getByRole("button", { name: "Contact", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Contact Us" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Email").fill("audit-test@example.com");
    await dialog.getByLabel("Message").fill("Automated browser compatibility audit — not a real inquiry.");
    await expect(dialog.getByRole("button", { name: /send message/i })).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("Claim Your Venue entry point loads", async ({ page }) => {
    await page.goto("/claim-your-venue");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/claim your venue/i);
    await expect(page.getByRole("link", { name: /find my venue/i })).toBeVisible();
  });

  test("Claim This Venue modal opens from an unclaimed venue's page, if one exists", async ({ page }) => {
    await page.goto("/website-happy-hours");
    const card = page.locator("a").filter({ has: page.getByRole("heading", { level: 3 }) }).first();
    if (!(await card.count())) {
      test.skip(true, "No venues available for this market at test time.");
    }
    await card.click();

    const claimTrigger = page.getByRole("button", { name: /claim this venue/i });
    if (!(await claimTrigger.count())) {
      test.skip(true, "First venue found is already claimed — no Claim CTA to test.");
    }
    await claimTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Claim This Venue" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /submit claim/i })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
  });
});
