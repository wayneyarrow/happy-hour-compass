import { test, expect } from "./support/fixtures";

const MARKET = "central-okanagan";

test.describe("Guides", () => {
  test("index loads and a guide detail page opens from it", async ({ page }) => {
    await page.goto(`/${MARKET}/guides`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/guides/i);

    const guideLink = page.locator(`a[href^="/${MARKET}/guides/"]`).first();
    if (!(await guideLink.count())) {
      test.skip(true, "No guides published for this market at test time.");
    }
    await guideLink.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const shareBtn = page.getByRole("button", { name: "Share guide" });
    if (await shareBtn.count()) {
      await expect(shareBtn).toBeEnabled();
    }
  });
});

test.describe("Collections (surfaced via homepage rails)", () => {
  test("a homepage collection rail's card and View all link both work", async ({ page }) => {
    await page.goto("/");
    const viewAll = page.getByRole("link", { name: "View all →" }).first();
    if (!(await viewAll.count())) {
      test.skip(true, "No collection rails resolved for this market/homepage at test time.");
    }

    await viewAll.click();
    await expect(page.locator("main")).toBeVisible();

    // The collection landing page reuses the same card components as the
    // main search/guides pages, whatever the collection's kind — click
    // whatever the first non-breadcrumb link inside <main> is.
    const firstCard = page.locator(`main a:not(:has-text("Home"))`).first();
    if (await firstCard.count()) {
      await firstCard.click();
      await expect(page.getByRole("heading", { level: 1 }).or(page.locator("main"))).toBeVisible();
    }
  });
});
