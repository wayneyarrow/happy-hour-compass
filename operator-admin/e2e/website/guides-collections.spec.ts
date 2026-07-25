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

    // Wait for the actual client-side navigation to the collection page to
    // land before looking for cards. Without this, the homepage's own <main>
    // (still on screen mid-transition) satisfies a same-tick locator query
    // just as well as the destination page's <main> does, so a query issued
    // right after the click can resolve against stale homepage content —
    // e.g. the Hero's "Browse Happy Hours" CTA, which also lives inside
    // <main> and precedes the rail cards in DOM order. `expect.poll` on the
    // pathname (rather than `page.waitForURL`, which waits on a "load"
    // lifecycle event) is used because this is a Next.js client-side
    // (pushState) transition, not a full document navigation.
    const collectionHref = await viewAll.getAttribute("href");
    await viewAll.click();
    if (collectionHref) {
      await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe(collectionHref);
    }
    await expect(page.locator("main")).toBeVisible();

    // The collection landing page reuses the same card components as the
    // main search/guides pages, whatever the collection's kind — click
    // whatever the first non-breadcrumb link inside <main> is. `:visible` is
    // required for the venue/event kinds: they reuse the happy-hours/events
    // search layout, which renders separate desktop (`hidden md:flex`) and
    // mobile (`md:hidden`) result columns simultaneously in the DOM — an
    // unfiltered locator picks up whichever renders first regardless of
    // which one the current viewport can actually see.
    const firstCard = page.locator(`main a:visible:not(:has-text("Home"))`).first();
    if (await firstCard.count()) {
      await firstCard.click();
      // Every destination (venue, event, or guide detail page) renders
      // exactly one <h1> — the same stable assertion used by the other
      // detail-page specs (events.spec.ts, venue-detail.spec.ts). `.or()`
      // is wrong here: it unions the two locators rather than picking
      // whichever matches, so it strict-mode-violates as soon as both an
      // <h1> and a <main> are simultaneously present, which is true on
      // essentially every page.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});
