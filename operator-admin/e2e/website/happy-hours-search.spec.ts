import { test, expect, expectNoHorizontalOverflow } from "./support/fixtures";

async function urlSearch(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.location.search);
}

test.describe("Happy Hours search", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/website-happy-hours");
  });

  test("results page loads with a result count", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Happy Hours" })).toBeVisible();
    await expect(page.getByText(/\d+ venues?|no venues found/i).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("text search filters without crashing", async ({ page }) => {
    const input = page.getByPlaceholder("Search by name, type, or specials…");
    await input.fill("a");
    await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();
    await input.fill("");
  });

  test("Day filter opens and updates the URL", async ({ page }) => {
    await page.getByRole("button", { name: /^Day: /i }).click();
    await page.getByRole("button", { name: "Monday", exact: true }).click();
    await expect(page.getByRole("button", { name: "Day: Monday" })).toBeVisible();
    await expect.poll(() => urlSearch(page)).toContain("day=mon");
  });

  test("On Now toggles, disables Day, and updates the URL both ways", async ({ page }) => {
    const onNow = page.getByRole("button", { name: "On Now", exact: true });
    const dayChip = page.getByRole("button", { name: /^Day: /i });

    await onNow.click();
    await expect(dayChip).toBeDisabled();
    await expect.poll(() => urlSearch(page)).toContain("now=1");

    await onNow.click();
    await expect(dayChip).toBeEnabled();
    await expect.poll(() => urlSearch(page)).not.toContain("now=1");
  });

  test("Time range control is usable and updates the chip + URL", async ({ page }) => {
    await page.getByRole("button", { name: "Time", exact: true }).click();
    // The Time popover renders two copies of these fields with the same
    // #hh-time-from / #hh-time-to ids at once — a desktop absolute popover
    // (`hidden md:block`) and a mobile inline panel (`md:hidden`) — so an
    // unfiltered id locator is ambiguous regardless of viewport. `:visible`
    // scopes to whichever copy the current viewport actually renders. See
    // TimeFilterFields in HappyHoursSearchClient.tsx — flagged separately as
    // an application cleanup item (duplicate ids), not fixed here.
    const fromSelect = page.locator("#hh-time-from:visible");
    const toSelect = page.locator("#hh-time-to:visible");
    await expect(fromSelect).toBeVisible();

    await fromSelect.selectOption({ index: 1 });
    await toSelect.selectOption({ index: 1 });

    await expect(page.getByRole("button", { name: /^Time: /i })).toBeVisible();
    await expect.poll(() => urlSearch(page)).toMatch(/from=\d{2}:\d{2}/);
    await expect.poll(() => urlSearch(page)).toMatch(/to=\d{2}:\d{2}|to=24:00/);
  });

  test("Sort control changes the active sort and the URL", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sort: Nearest" })).toBeVisible();
    await page.getByRole("button", { name: "Sort: Nearest" }).click();
    await page.getByRole("button", { name: "Top Rated First" }).click();
    await expect(page.getByRole("button", { name: "Sort: Top Rated" })).toBeVisible();
    await expect.poll(() => urlSearch(page)).toContain("sort=rating");
  });

  test("Near Me can be clicked without crashing when location permission is absent", async ({ page }) => {
    // No geolocation permission is granted to this browser context (default),
    // so the app should treat this exactly like a user who denied location —
    // clicking Near Me must not throw or leave the page in a broken state.
    await page.getByRole("button", { name: "Near Me", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Happy Hours" })).toBeVisible();
  });

  test("Clear all resets every filter and the URL", async ({ page }) => {
    await page.getByRole("button", { name: "On Now", exact: true }).click();
    await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("button", { name: "On Now", exact: true })).not.toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect.poll(() => urlSearch(page)).toBe("");
  });

  test("a result card is clickable and opens the venue page", async ({ page }) => {
    const firstCardHeading = page.getByRole("heading", { level: 3 }).first();
    const emptyState = page.getByText("No venues found");
    await expect(firstCardHeading.or(emptyState)).toBeVisible();

    if (!(await firstCardHeading.count())) {
      test.skip(true, "No venues available for this market at test time.");
    }
    await firstCardHeading.click();
    await expect(page).toHaveURL(/\/central-okanagan\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("desktop shows a list/map split; mobile shows a collapsible map", async ({ page }) => {
    const viewport = page.viewportSize();
    const isDesktop = (viewport?.width ?? 0) >= 768;

    if (isDesktop) {
      // Desktop split layout: results column + sticky map column both present.
      await expect(page.locator(".hidden.md\\:flex").first()).toBeVisible();
    } else {
      const expandButton = page.getByRole("button", { name: "Expand map" });
      await expect(expandButton).toBeVisible();
      await expandButton.click();
      await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
      await page.getByRole("button", { name: "Done" }).click();
      await expect(expandButton).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });
});
