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
    // The clear action is its own sibling <button aria-label="Clear filter">
    // next to the chip's main toggle button (see FilterChip in
    // EventSearchResults.tsx — previously a non-nested-interactive `<span
    // role="button">`), so its accessible name no longer collides with the
    // parent chip's; `exact: true` is kept as normal best practice, not to
    // resolve an ambiguity.
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

  test("a card's Save event control is independent of its link and never navigates", async ({ page }) => {
    const firstCardHeading = page.getByRole("heading", { level: 3 }).first();
    if (!(await firstCardHeading.count())) {
      test.skip(true, "No events available for this market at test time.");
    }

    // Save event used to be a <button> nested inside the card's <a> —
    // invalid HTML (a link may not contain other interactive content) and
    // inaccessible. Confirm no card link contains it as a descendant (see
    // EventSearchCard.tsx — the Save button is now a sibling of the Link,
    // not nested inside it).
    await expect(page.locator('a:has(button[aria-label="Save event"])')).toHaveCount(0);

    const saveBtn = page.getByRole("button", { name: "Save event" }).first();
    await expect(saveBtn).toBeVisible();

    // Mouse click toggles save state without navigating away from the list.
    await saveBtn.click();
    await expect(page).toHaveURL("/website-events");
    const removeBtn = page.getByRole("button", { name: "Remove saved event" }).first();
    await expect(removeBtn).toBeVisible();

    // Unsaving is equally side-effect-free on navigation.
    await removeBtn.click();
    await expect(page).toHaveURL("/website-events");
    await expect(saveBtn).toBeVisible();

    // Keyboard: the button is independently focusable and Enter activates
    // only the save action, not the card's navigation.
    await saveBtn.focus();
    await expect(saveBtn).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/website-events");
    await expect(page.getByRole("button", { name: "Remove saved event" }).first()).toBeVisible();
    // Leave state as found — unsave again so the localStorage-only save list
    // this throwaway browser context leaves behind doesn't linger.
    await page.getByRole("button", { name: "Remove saved event" }).first().click();
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
