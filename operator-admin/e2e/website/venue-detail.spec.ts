import { test, expect, expectNoHorizontalOverflow } from "./support/fixtures";
import type { Page } from "@playwright/test";

/** Discovers a real venue URL via the search results page rather than assuming a fixed slug. */
async function findVenueHref(page: Page): Promise<string | null> {
  await page.goto("/website-happy-hours");
  const card = page.locator("a").filter({ has: page.getByRole("heading", { level: 3 }) }).first();
  if (!(await card.count())) return null;
  return card.getAttribute("href");
}

test.describe("Venue detail page", () => {
  test("loads with happy-hour info, images, share and directions", async ({ page }) => {
    const href = await findVenueHref(page);
    if (!href) test.skip(true, "No venues available for this market at test time.");

    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const shareBtn = page.getByRole("button", { name: "Share venue" });
    if (await shareBtn.count()) {
      await expect(shareBtn).toBeEnabled();
    }

    const directionsLink = page.getByRole("link", { name: /directions/i }).first();
    if (await directionsLink.count()) {
      await expect(directionsLink).toBeVisible();
      const directionsHref = await directionsLink.getAttribute("href");
      expect(directionsHref, "Directions link should point at Google Maps").toMatch(
        /google\.com\/maps/
      );
    }

    await expectNoHorizontalOverflow(page);
  });

  test("?section=happy-hour deep link loads without breaking the page", async ({ page }) => {
    const href = await findVenueHref(page);
    if (!href) test.skip(true, "No venues available for this market at test time.");

    const separator = href!.includes("?") ? "&" : "?";
    await page.goto(`${href}${separator}section=happy-hour`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("photo gallery opens without a browser-specific crash", async ({ page }) => {
    const href = await findVenueHref(page);
    if (!href) test.skip(true, "No venues available for this market at test time.");

    await page.goto(href!);
    const showAllPhotos = page.getByRole("button", { name: /show all \d+ photos|view all \d+ photos/i });
    if (!(await showAllPhotos.count())) {
      test.skip(true, "This venue has no gallery to expand.");
    }
    await showAllPhotos.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
  });
});
