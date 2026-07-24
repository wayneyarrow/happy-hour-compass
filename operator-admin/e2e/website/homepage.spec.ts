import { test, expect, expectNoHorizontalOverflow } from "./support/fixtures";

test.describe("Homepage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads with hero, header, and no horizontal overflow", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/where should we go/i);
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Happy Hour Compass — Home" })
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("location control opens and closes", async ({ page }) => {
    const trigger = page.getByRole("button", { name: /tap to change location/i });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Location switcher" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("Happy Hours / Events toggle switches copy and CTA", async ({ page }) => {
    const group = page.getByRole("group", { name: "Content type" });
    const happyHoursBtn = group.getByRole("button", { name: "Happy Hours" });
    const eventsBtn = group.getByRole("button", { name: "Events" });

    await expect(happyHoursBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: /browse happy hours/i })).toBeVisible();

    await eventsBtn.click();
    await expect(eventsBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: /show me events/i })).toBeVisible();
    await expect(page.getByText(/discover what's happening near you/i)).toBeVisible();

    await happyHoursBtn.click();
    await expect(happyHoursBtn).toHaveAttribute("aria-pressed", "true");
  });

  test("homepage search shows suggestions and a see-all action", async ({ page }) => {
    const search = page.getByRole("combobox", { name: "Search happy hours" });
    await search.fill("a");

    const listbox = page.getByRole("listbox", { name: "Venue suggestions" });
    await expect(listbox).toBeVisible();
    // Either matching venues (+ a "see all" discovery action) or an explicit
    // empty state — both are valid outcomes; a silent blank dropdown is not.
    await expect(
      listbox.getByRole("option").first().or(listbox.getByText(/no venues found/i))
    ).toBeVisible();

    const seeAll = listbox.getByRole("option", { name: /see all happy hours matching/i });
    if (await seeAll.count()) {
      await seeAll.click();
      await expect(page).toHaveURL(/\/website-happy-hours\?q=/);
    }
  });

  test("Browse Happy Hours CTA navigates to search results", async ({ page }) => {
    await page.getByRole("link", { name: /browse happy hours/i }).click();
    await expect(page).toHaveURL(/\/website-happy-hours/);
  });

  test("a homepage collection rail's View all link navigates successfully", async ({ page }) => {
    const viewAll = page.getByRole("link", { name: "View all →" }).first();
    if (!(await viewAll.count())) {
      test.skip(true, "No collection rails resolved for this market/homepage at test time.");
    }
    await viewAll.click();
    await expect(page.locator("main")).toBeVisible();
  });

  test("footer renders with usable links", async ({ page }) => {
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();

    const aboutLink = footer.getByRole("link", { name: "About" });
    await expect(aboutLink).toBeVisible();
    await aboutLink.click();
    await expect(page).toHaveURL(/\/about/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
