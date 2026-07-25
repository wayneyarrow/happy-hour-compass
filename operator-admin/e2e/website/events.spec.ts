import { test, expect, expectNoHorizontalOverflow } from "./support/fixtures";

async function urlSearch(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.location.search);
}

test.describe("Events search", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/website-events");
  });

  test("results page loads", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("Today / Tomorrow / Weekend controls filter and update the URL", async ({ page }) => {
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect.poll(() => urlSearch(page)).toContain("date=today");

    await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await expect.poll(() => urlSearch(page)).toContain("date=tomorrow");

    await page.getByRole("button", { name: "This Weekend", exact: true }).click();
    await expect.poll(() => urlSearch(page)).toContain("date=weekend");

    // Clearing the active date chip removes the filter and its URL param.
    // `exact: true` is required here: without it, the substring match also
    // matches the parent chip button, whose accessible name concatenates to
    // "This Weekend Clear filter" (the chip's visible label plus the nested
    // clear icon's aria-label).
    await page.getByRole("button", { name: "Clear filter", exact: true }).click();
    await expect.poll(() => urlSearch(page)).not.toContain("date=");
  });

  test("Event Type filter is usable", async ({ page }) => {
    const typeChip = page.getByRole("button", { name: /^Event Type$|^Type: /i }).first();
    if (!(await typeChip.count())) {
      test.skip(true, "Event Type control not present in this build.");
    }
    await typeChip.click();
    const allTypes = page.getByRole("button", { name: "All Types" });
    await expect(allTypes).toBeVisible();
    await allTypes.click();
  });

  test("an event card is clickable and opens the event detail page", async ({ page }) => {
    const firstCardHeading = page.getByRole("heading", { level: 3 }).first();
    const emptyState = page.getByText(/no events|no upcoming events/i);
    await expect(firstCardHeading.or(emptyState)).toBeVisible();

    if (!(await firstCardHeading.count())) {
      test.skip(true, "No events available for this market at test time.");
    }
    await firstCardHeading.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("Event detail page", () => {
  test("loads with Make a Night of It and key sections, no obvious breakage", async ({ page }) => {
    await page.goto("/website-events");
    const firstCardHeading = page.getByRole("heading", { level: 3 }).first();
    if (!(await firstCardHeading.count())) {
      test.skip(true, "No events available for this market at test time.");
    }
    await firstCardHeading.click();

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // "Make a Night of It" only renders when the event's venue has a
    // reachable Happy Hour section — treat as optional, not a hard failure.
    const makeANight = page.getByRole("heading", { name: "Make a Night of It" });
    if (await makeANight.count()) {
      await expect(makeANight).toBeVisible();
    }

    const shareBtn = page.getByRole("button", { name: "Share event" });
    if (await shareBtn.count()) {
      await expect(shareBtn).toBeEnabled();
    }

    await expectNoHorizontalOverflow(page);
  });
});
