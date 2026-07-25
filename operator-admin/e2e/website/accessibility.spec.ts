import { test, expect } from "./support/fixtures";

test.describe("Skip to main content", () => {
  test("is the first keyboard-focusable control, hidden until focused, and jumps to <main>", async ({ page }) => {
    await page.goto("/");

    const skipLink = page.locator('a[href="#main-content"]');
    // Off-screen (sr-only) before it has focus — doesn't affect pointer-user
    // layout.
    const beforeBox = await skipLink.boundingBox();
    expect(beforeBox?.width ?? 0).toBeLessThanOrEqual(1);

    // First Tab stop on a fresh page load.
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();

    // Now visible (focus:not-sr-only).
    const afterBox = await skipLink.boundingBox();
    expect(afterBox?.width ?? 0).toBeGreaterThan(50);

    // Activating it moves focus straight to <main>, not just the URL hash.
    await page.keyboard.press("Enter");
    const main = page.locator("#main-content");
    await expect(main).toBeFocused();
  });
});

test.describe("Browser geolocation denial feedback", () => {
  test("a denied/unavailable location shows one clear, polite message and doesn't block manual region selection", async ({ page }) => {
    // Deterministic denial regardless of the real browser permission
    // dialog, which Playwright can't reliably drive headlessly across
    // browser engines.
    await page.addInitScript(() => {
      window.navigator.geolocation.getCurrentPosition = (_success, error) => {
        error?.({ code: 1, message: "User denied Geolocation" } as GeolocationPositionError);
      };
    });

    await page.goto("/");
    const trigger = page.getByRole("button", { name: /tap to change location/i });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Location switcher" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Change Region" }).click();
    await dialog.getByRole("button", { name: /use my location/i }).click();

    const message = dialog.getByText(/couldn.t access your location/i);
    await expect(message).toBeVisible();
    await expect(message).toHaveAttribute("role", "status");
    await expect(message).toHaveAttribute("aria-live", "polite");
    // Directs the user toward the manual fallback rather than a dead end.
    await expect(message).toContainText(/choose a region below instead/i);

    // Normal use (manual region selection) is still fully available —
    // the denial doesn't block or replace the rest of the picker.
    const activeRegions = dialog.getByRole("button").filter({ hasNotText: /use my location|change region|back/i });
    await expect(activeRegions.first()).toBeEnabled();

    // Doesn't linger/reappear on its own — it's tied to this attempt only.
    await page.keyboard.press("Escape");
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(message).toHaveCount(0);
  });
});

test.describe("Guide card and Saved guide card — nested-interactive fix", () => {
  test("Save Guide is independently focusable, saving doesn't navigate, and the guide link still navigates — same on the Saved page", async ({ page }) => {
    await page.goto("/");

    const saveButtons = page.getByRole("button", { name: "Save guide" });
    if (!(await saveButtons.count())) {
      test.skip(true, "No guide cards resolved on the homepage for this market at test time.");
    }

    // Pin to one specific DOM node up front. Locators built from an
    // accessible-name filter ("Save guide") re-evaluate on every action —
    // once this button's own label flips to "Remove saved guide" after the
    // click below, that filter would silently re-resolve to a *different*
    // card. An ElementHandle snapshot avoids that drift.
    const cardHandle = await page
      .locator("article")
      .filter({ has: page.getByRole("button", { name: "Save guide" }) })
      .first()
      .elementHandle();
    if (!cardHandle) test.skip(true, "Guide card element unavailable.");

    const linkHandle = (await cardHandle!.$("a"))!;
    const saveBtnHandle = (await cardHandle!.$("button"))!;
    const href = await linkHandle.getAttribute("href");

    // The structural fix under test: Save must not be a descendant of the
    // navigation <a> — a <button> nested inside an <a> is invalid HTML and
    // unreliable for keyboard/assistive tech.
    expect(await saveBtnHandle.evaluate((el) => el.closest("a") !== null)).toBe(false);
    expect(await saveBtnHandle.getAttribute("aria-pressed")).toBe("false");

    const urlBeforeSave = page.url();
    await saveBtnHandle.click();
    await expect
      .poll(() => saveBtnHandle.getAttribute("aria-pressed"))
      .toBe("true");
    expect(await saveBtnHandle.getAttribute("aria-label")).toBe("Remove saved guide");
    // Saving is a sibling interaction — it must not navigate.
    expect(page.url()).toBe(urlBeforeSave);

    // The link is independently keyboard-focusable and still navigates.
    await linkHandle.click();
    await page.waitForURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The same guide now appears on the Saved page via SavedGuideEditorialCard
    // — same nested-interactive fix, applied independently there.
    await page.goto("/saved");
    const savedCard = page.locator("main article").first();
    await expect(savedCard).toBeVisible();
    const removeBtn = savedCard.getByRole("button", { name: "Remove saved guide" });
    await expect(removeBtn).toBeVisible();
    expect(await removeBtn.evaluate((el) => el.closest("a") !== null)).toBe(false);
    await expect(savedCard.getByRole("link")).toHaveAttribute("href", href!);
  });
});
