import { test, expect, expectNoHorizontalOverflow } from "./support/fixtures";
import type { Browser, Page } from "@playwright/test";

/**
 * Greater San Diego market — selection, defaults, cross-market search, map
 * scoping, and venue-local time display.
 *
 * Country defaults need the dev server to trust the `x-vercel-ip-country`
 * header locally: run with HHC_TRUST_GEO_HEADERS_FOR_QA=1 (never set on a
 * deployment, where Vercel's edge sets the header). Those tests skip
 * otherwise, and always against a BASE_URL deployment (the header can't be
 * forged there).
 *
 * Encore Sushi checks need it published (after the rollout in
 * docs/operations/GREATER_SAN_DIEGO_ROLLOUT.md): GSD_ENCORE_LIVE=1.
 * Run with E2E_INTERCEPT_TRACKING=1 so nothing writes to the shared DB.
 */

// Local = no BASE_URL, or a BASE_URL on this machine (e.g. localhost:3000,
// the one local origin the Google Maps key accepts).
const LOCAL = !process.env.BASE_URL || /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(process.env.BASE_URL);
const TRUSTS_GEO = LOCAL && process.env.HHC_TRUST_GEO_HEADERS_FOR_QA === "1";
const ENCORE_LIVE = process.env.GSD_ENCORE_LIVE === "1";
const ENCORE_PATH = "/greater-san-diego/solana-beach/solana-beach-encore-sushi";

const locationTrigger = (page: Page) => page.getByRole("button", { name: /Browsing near .* Tap to change location/ });

async function headerLabel(page: Page) {
  return (await locationTrigger(page).getAttribute("aria-label")) ?? "";
}

async function switchMarket(page: Page, marketName: string) {
  await locationTrigger(page).click();
  await page.getByRole("dialog", { name: "Location switcher" }).getByRole("button", { name: "Change Region" }).click();
  await page.getByRole("dialog", { name: "Location switcher" }).getByRole("button", { name: marketName, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Location switcher" })).toBeHidden({ timeout: 15_000 });
}

async function marketCookie(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "hhc_market")?.value ?? null;
}

const visibleCards = (page: Page) => page.locator("article:visible h3");

/**
 * A fresh browser context (for a different timezone) that never sends
 * tracking: every /api/track/* request is answered locally, always — the
 * shared fixture's intercept only covers the default `page`.
 */
async function quietContext(browser: Browser, options: Parameters<Browser["newContext"]>[0]) {
  const context = await browser.newContext(options);
  await context.route("**/api/track/**", (route) => route.fulfill({ status: 204, body: "" }));
  return context;
}

test.describe("Greater San Diego — market selection", () => {
  test("selector lists Greater San Diego and switching updates header, cookie and browsing together", async ({ page }) => {
    await page.goto("/");
    await expect(locationTrigger(page)).toBeVisible();
    expect(await headerLabel(page)).toMatch(/Kelowna|Central Okanagan/);

    await switchMarket(page, "Greater San Diego");
    await expect.poll(() => headerLabel(page)).toMatch(/Browsing near Greater San Diego\./);
    expect(await marketCookie(page)).toBe("greater-san-diego");

    // Market-scoped browsing follows the selection.
    await page.goto("/website-happy-hours");
    await expect.poll(() => headerLabel(page)).toMatch(/Browsing near Greater San Diego\./);
    if (!ENCORE_LIVE) {
      // Before rollout no Greater San Diego venue is published: nothing from
      // Central Okanagan leaks into its browsing.
      await expect(page.getByText(/^no venues found$/i).and(page.locator(":visible"))).toBeVisible();
    }

    // Refresh keeps the explicit choice.
    await page.reload();
    await expect.poll(() => headerLabel(page)).toMatch(/Browsing near Greater San Diego\./);

    // And back.
    await switchMarket(page, "Central Okanagan");
    expect(await marketCookie(page)).toBe("central-okanagan");
    await expect.poll(() => headerLabel(page)).toMatch(/Kelowna|Central Okanagan/);
    await expectNoHorizontalOverflow(page);
  });

  test("a saved choice wins over the country default; a shared venue link never changes it", async ({ page, context, baseURL }) => {
    test.skip(!TRUSTS_GEO, "needs HHC_TRUST_GEO_HEADERS_FOR_QA=1 on a local dev server");
    await context.setExtraHTTPHeaders({ "x-vercel-ip-country": "US" });
    await context.addCookies([{ name: "hhc_market", value: "central-okanagan", url: baseURL! }]);
    await page.goto("/");
    expect(await headerLabel(page)).toMatch(/Kelowna|Central Okanagan/);
    // Opening another market's venue (a shared link) leaves the choice alone.
    await page.goto("/website-happy-hours");
    expect(await marketCookie(page)).toBe("central-okanagan");
  });
});

test.describe("Greater San Diego — newsletter is Central Okanagan only", () => {
  const signup = (page: Page) => page.getByRole("region", { name: /Your Happy Hour Plans newsletter signup/i }).or(page.getByText(/Kelowna, West Kelowna and Lake Country/));

  test("Greater San Diego homepage: no signup band, no Kelowna copy, no Newsletter link", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "hhc_market", value: "greater-san-diego", url: baseURL! }]);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Browse Happy Hours/i }).or(page.getByRole("link", { name: /Browse Happy Hours/i })).first()).toBeVisible();
    await expect(signup(page)).toHaveCount(0);
    await expect(page.getByText(/Your Happy Hour Plans/)).toHaveCount(0);
    if (test.info().project.name.startsWith("mobile")) {
      await page.getByRole("button", { name: "Navigation menu" }).click();
      await expect(page.getByRole("link", { name: "Saved" }).or(page.getByRole("button", { name: "Add Your Venue" })).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Newsletter", exact: true })).toHaveCount(0);
  });

  test("Central Okanagan homepage still offers the newsletter and the Newsletter link", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "hhc_market", value: "central-okanagan", url: baseURL! }]);
    await page.goto("/");
    await expect(page.getByText(/Your Happy Hour Plans/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Kelowna, West Kelowna and Lake Country/).first()).toBeVisible();
    // Desktop header nav, or the mobile menu once opened.
    if (test.info().project.name.startsWith("mobile")) {
      await page.getByRole("button", { name: "Navigation menu" }).click();
    }
    await expect(page.getByRole("link", { name: "Newsletter", exact: true }).first()).toBeAttached();
  });
});

test.describe("Greater San Diego — first-visit country default", () => {
  for (const [country, expected] of [
    ["US", /Browsing near Greater San Diego\./],
    ["CA", /Kelowna|Central Okanagan/],
    ["GB", /Kelowna|Central Okanagan/],
    [null, /Kelowna|Central Okanagan/],
  ] as const) {
    test(`country ${country ?? "unknown"} → ${expected}`, async ({ page, context }) => {
      test.skip(!TRUSTS_GEO, "needs HHC_TRUST_GEO_HEADERS_FOR_QA=1 on a local dev server");
      if (country) await context.setExtraHTTPHeaders({ "x-vercel-ip-country": country });
      await page.goto("/");
      expect(await headerLabel(page)).toMatch(expected);
      // The default is never persisted — only an explicit choice is.
      expect(await marketCookie(page)).toBeNull();
    });
  }
});

test.describe("Greater San Diego — cross-market search and map", () => {
  test("from Greater San Diego, a Central Okanagan venue is found by name and labelled, but never browsed", async ({ page }) => {
    // Pick a real published Central Okanagan venue from its own listing.
    await page.goto("/website-happy-hours");
    await expect(visibleCards(page).first()).toBeVisible({ timeout: 20_000 });
    const name = (await visibleCards(page).first().textContent())!.trim();

    await switchMarket(page, "Greater San Diego");
    await page.goto("/website-happy-hours");
    const input = page.getByPlaceholder("Search by name, type, or specials…");
    await input.fill(name);
    const card = page.locator("article:visible").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card.first()).toBeVisible({ timeout: 20_000 });
    await expect(card.first().getByTestId("card-location")).toHaveText(/, BC$/);

    // A topical search stays local: Central Okanagan's specials don't leak in.
    await input.fill("wings");
    await expect(page.getByTestId("other-market-matches").and(page.locator(":visible"))).toHaveCount(0);
    // Searching never changes the saved market.
    expect(await marketCookie(page)).toBe("greater-san-diego");
  });

  test("hero suggestions find another market's venue by name with its location", async ({ page }) => {
    await page.goto("/website-happy-hours");
    await expect(visibleCards(page).first()).toBeVisible({ timeout: 20_000 });
    const name = (await visibleCards(page).first().textContent())!.trim();
    await switchMarket(page, "Greater San Diego");
    await page.goto("/");
    const hero = page.getByRole("combobox").first();
    await hero.fill(name);
    // The venue row (not the "See all …" action) carries "City, BC".
    const venueOption = page.getByRole("option").filter({ hasNotText: /^See all/ }).filter({ hasText: name });
    await expect(venueOption.first()).toContainText(/, BC/, { timeout: 15_000 });
  });

  test("Encore Sushi: in Greater San Diego browsing, found by name from Central Okanagan", async ({ page }) => {
    test.skip(!ENCORE_LIVE, "Encore Sushi not published yet (GSD_ENCORE_LIVE=1 after rollout)");
    await page.goto("/website-happy-hours");
    await switchMarket(page, "Greater San Diego");
    await page.goto("/website-happy-hours");
    await expect(page.locator("article:visible").filter({ hasText: "Encore Sushi" }).first()).toBeVisible({ timeout: 20_000 });

    await switchMarket(page, "Central Okanagan");
    await page.goto("/website-happy-hours");
    await expect(page.locator("article:visible").filter({ hasText: "Encore Sushi" })).toHaveCount(0);
    await page.getByPlaceholder("Search by name, type, or specials…").fill("Encore Sushi");
    const encore = page.locator("article:visible").filter({ hasText: "Encore Sushi" }).first();
    await expect(encore).toBeVisible({ timeout: 20_000 });
    await expect(encore.getByTestId("card-location")).toHaveText("Solana Beach, CA");
    expect(await marketCookie(page)).toBe("central-okanagan");
  });
});

test.describe("Greater San Diego — map", () => {
  test("zooming the map out from Greater San Diego reveals another market's venues without changing the saved market", async ({ page }) => {
    test.skip(test.info().project.name.startsWith("mobile"), "desktop split map; mobile expanded map shares the same bounds logic");
    await page.goto("/");
    await switchMarket(page, "Greater San Diego");
    await page.goto("/website-happy-hours");
    const map = page.locator(".gm-style").first();
    await expect(map).toBeVisible({ timeout: 20_000 });
    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Zoom out until Central Okanagan (≈1,500 km north) is in view.
    const anyBc = page.getByTestId("card-location").and(page.locator(":visible")).filter({ hasText: /, BC$/ });
    for (let i = 0; i < 12 && (await anyBc.count()) === 0; i++) {
      // Cooperative gesture handling: Ctrl + wheel zooms the map (a plain
      // wheel scrolls the page).
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 400);
      await page.keyboard.up("Control");
      await page.waitForTimeout(700);
    }
    await expect(anyBc.first()).toBeVisible({ timeout: 10_000 });
    expect(await marketCookie(page)).toBe("greater-san-diego");
    await expect.poll(() => headerLabel(page)).toMatch(/Browsing near Greater San Diego\./);
  });
});

test.describe("Greater San Diego — map after Encore is live", () => {
  test("starting in Kelowna, the map can be moved to Solana Beach to find Encore Sushi's pin", async ({ page }) => {
    test.skip(!ENCORE_LIVE, "Encore Sushi not published yet (GSD_ENCORE_LIVE=1 after rollout)");
    test.skip(test.info().project.name.startsWith("mobile"), "desktop split map");
    test.setTimeout(90_000);
    // A visitor who chose Central Okanagan.
    await page.context().addCookies([{ name: "hhc_market", value: "central-okanagan", url: test.info().project.use.baseURL ?? process.env.BASE_URL! }]);
    await page.goto("/website-happy-hours");
    const map = page.locator(".gm-style").first();
    await expect(map).toBeVisible({ timeout: 20_000 });
    // Opens on Kelowna: Encore is not in this market's browsing.
    const encoreCard = page.locator("article:visible").filter({ hasText: "Encore Sushi" });
    await expect(page.locator("article:visible").first()).toBeVisible();
    await expect(encoreCard).toHaveCount(0);

    // Zoom out from Kelowna until Encore Sushi's pin is on screen…
    const box = (await map.boundingBox())!;
    const pin = page.locator('.gm-style [title="Encore Sushi"]').first();
    // The on-screen part of the map (the map box can extend below the viewport).
    const bottom = Math.min(box.y + box.height, page.viewportSize()!.height) - 40;
    const inMap = (p: { x: number; y: number } | null) =>
      !!p && p.x > box.x + 10 && p.x < box.x + box.width - 10 && p.y > box.y + 10 && p.y < bottom;
    const zoom = async (at: { x: number; y: number }, dy: number) => {
      // Cooperative gesture handling: Ctrl + wheel zooms the map around the cursor.
      await page.mouse.move(at.x, at.y);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, dy);
      await page.keyboard.up("Control");
      await page.waitForTimeout(800);
    };
    const center = { x: box.x + box.width / 2, y: (box.y + bottom) / 2 };
    for (let i = 0; i < 14 && !inMap(await pin.boundingBox().catch(() => null)); i++) await zoom(center, 400);
    expect(inMap(await pin.boundingBox())).toBe(true);
    // …then zoom in on Solana Beach, keeping the cursor just below the pin
    // (on the map, not on the marker) so the pin stays in view.
    for (let i = 0; i < 10; i++) {
      const p = (await pin.boundingBox())!;
      await zoom({ x: p.x + p.width / 2, y: p.y + p.height + 6 }, -400);
    }
    expect(inMap(await pin.boundingBox())).toBe(true);
    // Only Encore Sushi is in view now — Kelowna's venues have left the list.
    await expect(page.locator("article:visible h3")).toHaveText(["Encore Sushi"]);
    await expect(encoreCard.first().getByTestId("card-location")).toHaveText("Solana Beach, CA");
    await page.screenshot({ path: test.info().outputPath("solana-beach-view.png") });
    await pin.click();
    await expect(page.locator(".gm-style-iw").getByText("Encore Sushi")).toBeVisible();
    // Moving the map never changes the saved market.
    expect(await marketCookie(page)).toBe("central-okanagan");
    await expect.poll(() => headerLabel(page)).toMatch(/Kelowna|Central Okanagan/);
  });
});

test.describe("Greater San Diego — venue-local time", () => {
  test("a Central Okanagan venue viewed from Los Angeles shows converted, labelled hours", async ({ browser, baseURL }) => {
    const context = await quietContext(browser, { timezoneId: "America/Los_Angeles", baseURL });
    const page = await context.newPage();
    await page.goto("/website-happy-hours");
    const firstCard = page.locator("article:visible a").first();
    await expect(firstCard).toBeVisible({ timeout: 20_000 });
    await page.goto((await firstCard.getAttribute("href"))!);
    expect(page.url()).toMatch(/\/central-okanagan\//);
    const caption = page.getByTestId("hh-time-zone-caption").or(page.getByTestId("business-hours-time-zone-caption"));
    await expect(caption.first()).toContainText("Times shown in your time (PST) · Venue local time: PDT", { timeout: 15_000 });
    await context.close();
  });

  test("a local visitor sees venue hours unchanged, with no caption", async ({ browser, baseURL }) => {
    const context = await quietContext(browser, { timezoneId: "America/Vancouver", baseURL });
    const page = await context.newPage();
    await page.goto("/website-happy-hours");
    const firstCard = page.locator("article:visible a").first();
    await expect(firstCard).toBeVisible({ timeout: 20_000 });
    await page.goto((await firstCard.getAttribute("href"))!);
    expect(page.url()).toMatch(/\/central-okanagan\//);
    await expect(page.getByText("Happy Hour Times").first()).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("hh-time-zone-caption")).toHaveCount(0);
    await expect(page.getByTestId("business-hours-time-zone-caption")).toHaveCount(0);
    await context.close();
  });

  test("Encore Sushi's public page opens logged out, in Pacific time for a Kelowna visitor", async ({ browser, baseURL }) => {
    test.skip(!ENCORE_LIVE, "Encore Sushi not published yet (GSD_ENCORE_LIVE=1 after rollout)");
    const context = await quietContext(browser, { timezoneId: "America/Vancouver", baseURL });
    const page = await context.newPage();
    const res = await page.goto(ENCORE_PATH);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Encore Sushi" })).toBeVisible();
    await expect(page.getByTestId("hh-time-zone-caption").first()).toContainText("Venue local time: P");
    await context.close();
  });
});

// ─── Step 2: region label, header fit, assigned-market browsing ─────────────

test.describe("Greater San Diego — Step 2 region label", () => {
  test("the header names the region, and fits the header no worse than Central Okanagan", async ({ page }) => {
    const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440];
    async function measure() {
      const out: Record<number, { label: string; truncated: boolean; rowOverflow: number; pageOverflow: number }> = {};
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(100);
        out[width] = await page.evaluate(() => {
          const chip = [...document.querySelectorAll('header button[aria-haspopup="listbox"] span.truncate')]
            .find((el) => getComputedStyle(el).display !== "none") as HTMLElement | undefined;
          const row = document.querySelector("header > div") as HTMLElement;
          const inner = row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight);
          const last = [...row.children].filter((k) => getComputedStyle(k).display !== "none").pop()!;
          return {
            label: chip?.textContent ?? "",
            truncated: chip ? chip.scrollWidth > chip.clientWidth : true,
            // How far the right-most header control pokes past the row's content edge.
            rowOverflow: Math.round(last.getBoundingClientRect().right - inner),
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
      }
      return out;
    }

    await page.goto("/website-happy-hours");
    if (!/Kelowna/.test(await headerLabel(page))) await switchMarket(page, "Central Okanagan");
    const kelowna = await measure();
    await page.setViewportSize({ width: 1280, height: 900 });
    await switchMarket(page, "Greater San Diego");
    await expect.poll(() => headerLabel(page)).toMatch(/Browsing near Greater San Diego\./);
    const sd = await measure();

    for (const width of WIDTHS) {
      const m = sd[width];
      // Full region name from the sm breakpoint up; the compact form on phones.
      expect(m.label, `label at ${width}px`).toBe(width >= 640 ? "Greater San Diego" : "San Diego");
      expect(m.truncated, `label truncated at ${width}px`).toBe(false);
      // Never worse than Central Okanagan's header (which already overflows at 320px — pre-existing).
      expect(m.rowOverflow, `row overflow at ${width}px vs Kelowna ${kelowna[width].rowOverflow}`).toBeLessThanOrEqual(Math.max(0, kelowna[width].rowOverflow));
      expect(m.pageOverflow, `page overflow at ${width}px vs Kelowna ${kelowna[width].pageOverflow}`).toBeLessThanOrEqual(Math.max(0, kelowna[width].pageOverflow));
      if (width >= 375) expect(m.pageOverflow, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(0);
    }
    // Central Okanagan keeps its city label.
    expect(kelowna[1280].label).toBe("Kelowna");
    // The dropdown doesn't repeat the region name as "Greater San Diego region".
    await page.setViewportSize({ width: 1280, height: 900 });
    await locationTrigger(page).click();
    await expect(page.getByRole("dialog", { name: "Location switcher" }).getByText("Greater San Diego region")).toHaveCount(0);
  });

  test("Encore Sushi keeps its Solana Beach URL and city", async ({ page }) => {
    test.skip(!ENCORE_LIVE, "Encore Sushi not published yet (GSD_ENCORE_LIVE=1 after rollout)");
    const res = await page.goto(ENCORE_PATH);
    expect(res?.status()).toBe(200);
    await expect(page.getByText("Solana Beach").first()).toBeVisible();
  });
});

// ─── Location selector fits the viewport (Pixel clipping regression) ───────

test.describe("Location selector — open panel fits the viewport", () => {
  /** Every visible element of the open panel (panel box, text, buttons), measured in one pass. */
  async function panelOutOfBounds(page: Page) {
    return page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Location switcher"]');
      if (!dialog) return ["no panel"];
      const vw = document.documentElement.clientWidth;
      const bad: string[] = [];
      for (const el of [dialog, ...dialog.querySelectorAll("p, span, button")]) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // hidden (e.g. display:none)
        if (r.left < 0 || r.right > vw) bad.push(`${(el.textContent ?? "").trim().slice(0, 30) || el.tagName} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
      }
      return bad;
    });
  }
  const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  for (const market of ["Greater San Diego", "Central Okanagan"]) {
    test(`${market}: the open selector and Change Region fit at 320–400 px and on desktop`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/website-happy-hours");
      if (!(await headerLabel(page)).includes(market === "Central Okanagan" ? "Kelowna" : market)) await switchMarket(page, market);

      for (const width of [320, 360, 375, 400, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(150);
        // With a desktop UA the closed header already scrolls sideways at 320px
        // (44–51px) and 360px (4–11px) — pre-existing, identical before this fix;
        // a Pixel 7 emulation shows none. Opening the menu must never add to it,
        // and from 375px there must be none at all.
        const before = await overflow(page);
        await locationTrigger(page).click();
        const dialog = page.getByRole("dialog", { name: "Location switcher" });
        await expect(dialog).toBeVisible();
        expect(await panelOutOfBounds(page), `panel elements outside the viewport at ${width}px`).toEqual([]);
        expect(await overflow(page), `opening the menu adds sideways scroll at ${width}px`).toBeLessThanOrEqual(Math.max(0, before));
        if (width >= 375) expect(await overflow(page), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(0);

        // Change Region view: every region option is visible, inside the viewport and usable.
        await dialog.getByRole("button", { name: "Change Region" }).click();
        for (const name of ["Central Okanagan", "Greater San Diego"]) {
          const option = dialog.getByRole("button", { name, exact: true });
          await expect(option).toBeVisible();
          await expect(option).toBeEnabled();
        }
        expect(await panelOutOfBounds(page), `region list outside the viewport at ${width}px`).toEqual([]);
        expect(await overflow(page)).toBeLessThanOrEqual(Math.max(0, before));
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }

      // Switching from the narrow panel still works and keeps the labels.
      await page.setViewportSize({ width: 360, height: 800 });
      const other = market === "Greater San Diego" ? "Central Okanagan" : "Greater San Diego";
      await switchMarket(page, other);
      await expect.poll(() => headerLabel(page)).toMatch(other === "Greater San Diego" ? /Greater San Diego/ : /Kelowna/);
      await switchMarket(page, market);
    });
  }
});
