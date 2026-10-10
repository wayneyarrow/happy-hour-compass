import { test, expect } from "./support/fixtures";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Search & discovery tracking foundation (migration 110) — real-browser
 * checks of WHEN events fire: visibility threshold, horizontal-rail
 * clipping, fast scroll-past, hidden tabs, once-per-page-view, double
 * clicks, search capture timing/origin/mode.
 *
 * SAFETY: every /api/track/* request is intercepted and fulfilled here with
 * 204 — nothing reaches the tracking routes, so this suite never writes a
 * row to the shared Supabase project (local dev and staging both use it).
 * The pages themselves only READ published data.
 *
 * Data-dependent: needs the published Kelowna Homepage (venue rails + a
 * feature) and at least one published venue guide. Run with
 *   npx playwright test e2e/website/discovery-tracking.spec.ts --project=chromium
 */

type Captured = { path: string; body: Record<string, unknown> };
type DiscoveryEvent = Record<string, unknown> & { eventType: string; pageViewId: string };

async function interceptTracking(context: BrowserContext): Promise<Captured[]> {
  const captured: Captured[] = [];
  await context.route("**/api/track/**", async (route) => {
    const req = route.request();
    let body: Record<string, unknown> = {};
    try {
      body = req.postDataJSON() as Record<string, unknown>;
    } catch {
      // non-JSON — ignore
    }
    captured.push({ path: new URL(req.url()).pathname, body });
    await route.fulfill({ status: 204, body: "" });
  });
  return captured;
}

function discoveryEvents(captured: Captured[]): DiscoveryEvent[] {
  return captured
    .filter((c) => c.path === "/api/track/discovery")
    .flatMap((c) => (c.body.events as DiscoveryEvent[]) ?? []);
}

function searchEvents(captured: Captured[]): Record<string, unknown>[] {
  return captured.filter((c) => c.path === "/api/track/website-search").map((c) => c.body);
}

/** Visible fraction of an element, clipped by the viewport and every overflow-clipping ancestor (what IntersectionObserver measures). */
async function visibleRatios(page: Page, selector: string): Promise<Record<string, number>> {
  return page.evaluate((sel) => {
    const out: Record<string, number> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      let left = Math.max(r.left, 0);
      let top = Math.max(r.top, 0);
      let right = Math.min(r.right, window.innerWidth);
      let bottom = Math.min(r.bottom, window.innerHeight);
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) {
          const ar = a.getBoundingClientRect();
          left = Math.max(left, ar.left);
          top = Math.max(top, ar.top);
          right = Math.min(right, ar.right);
          bottom = Math.min(bottom, ar.bottom);
        }
      }
      const area = Math.max(0, right - left) * Math.max(0, bottom - top);
      const key = `${el.dataset.discoveryPlacement ?? el.dataset.discoverySection}|${el.dataset.discoveryItem ?? "-"}`;
      out[key] = area / (r.width * r.height || 1);
    }
    return out;
  }, selector);
}

function eventKey(e: DiscoveryEvent): string {
  const placement =
    e.surface === "homepage_section" ? `s:${e.sectionId}` : e.surface === "guide" ? `g:${e.guideBlock}` : "hero";
  return `${placement}|${e.itemType && e.itemId ? `${e.itemType}:${e.itemId}` : "-"}`;
}

async function setDocumentHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.describe("Homepage discovery tracking", () => {
  test("impressions/exposures follow the ≥50%-for-1s rule, once per page view, clipped by rails", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const rails = page.locator("[data-discovery-section]");
    expect(await rails.count()).toBeGreaterThan(1);

    // Walk down the page in steps, resting 1.6s at each (≥1s continuous).
    const restingRatios: Array<Record<string, number>> = [];
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < pageHeight; y += 500) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), y);
      await page.waitForTimeout(1600);
      restingRatios.push(await visibleRatios(page, "[data-discovery-item],[data-discovery-section]"));
    }
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForTimeout(300);

    const events = discoveryEvents(captured).filter((e) => e.eventType === "item_impression" || e.eventType === "section_exposure");
    const recorded = new Set(events.map(eventKey));

    // Everything that sat ≥50% visible during a resting stop was recorded…
    const seen = new Set<string>();
    const neverHalfVisible = new Set<string>();
    for (const ratios of restingRatios) {
      for (const [key, ratio] of Object.entries(ratios)) {
        if (ratio >= 0.55) seen.add(key);
      }
    }
    for (const ratios of restingRatios) for (const key of Object.keys(ratios)) if (!seen.has(key)) neverHalfVisible.add(key);
    for (const ratios of restingRatios) for (const [key, ratio] of Object.entries(ratios)) if (ratio >= 0.45) neverHalfVisible.delete(key);

    for (const key of seen) expect(recorded, `expected an event for ${key}`).toContain(key);
    // …and nothing that never reached 50% (e.g. cards clipped off the right of a horizontal rail) was.
    expect(neverHalfVisible.size, "some rail cards should stay clipped off-screen").toBeGreaterThan(0);
    for (const key of neverHalfVisible) expect(recorded, `unexpected event for never-visible ${key}`).not.toContain(key);

    // Once per page view: no duplicate placement+item keys, one page view id.
    expect(events.length).toBe(recorded.size);
    expect(new Set(events.map((e) => e.pageViewId)).size).toBe(1);

    // Positions are the rendered order.
    for (const e of events.filter((ev) => ev.eventType === "item_impression")) {
      const pos = await page.locator(`[data-discovery-item="${e.itemType}:${e.itemId}"][data-discovery-placement="${eventKey(e).split("|")[0]}"]`).getAttribute("data-discovery-position");
      expect(Number(pos)).toBe(e.position);
    }

    // Scrolling back over everything again never re-fires within this page view.
    const before = discoveryEvents(captured).length;
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    await page.waitForTimeout(1600);
    await page.evaluate((h) => window.scrollTo({ top: h / 2, behavior: "instant" as ScrollBehavior }), pageHeight);
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForTimeout(300);
    expect(discoveryEvents(captured).length).toBe(before);
  });

  test("a fast scroll past (<1s) records nothing; a hidden tab records nothing until shown", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    const flushAndCount = async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await page.waitForTimeout(300);
      return discoveryEvents(captured).length;
    };
    const atTop = await flushAndCount();

    const lastSection = page.locator("[data-discovery-section]").last();
    // Fast scroll: bring the last section into view for ~300ms, then back to the top.
    await lastSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    await page.waitForTimeout(1500);
    expect(await flushAndCount()).toBe(atTop);

    // Hidden tab: scroll to it while hidden, wait well past 1s — nothing.
    await setDocumentHidden(page, true);
    await lastSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    expect(await flushAndCount()).toBe(atTop);

    // Shown again: the full second restarts, then it records.
    await setDocumentHidden(page, false);
    await page.waitForTimeout(400);
    expect(await flushAndCount()).toBe(atTop);
    await page.waitForTimeout(1200);
    expect(await flushAndCount()).toBeGreaterThan(atTop);
    const after = discoveryEvents(captured);
    expect(after.slice(atTop).some((e) => e.eventType === "section_exposure")).toBe(true);
  });

  test("a double-click on a card is one item_click with its shown position; View all and Browse are recorded", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Hero Browse (default mode Happy Hours)
    await page.getByRole("link", { name: /browse happy hours/i }).click();
    await page.waitForURL(/\/website-happy-hours/);
    let events = discoveryEvents(captured);
    const browse = events.filter((e) => e.eventType === "browse_click");
    expect(browse).toHaveLength(1);
    expect(browse[0]).toMatchObject({ surface: "homepage_hero", mode: "happy_hours", targetPath: "/website-happy-hours" });

    // View all on the first rail
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const viewAll = page.getByRole("link", { name: /view all/i }).first();
    const viewAllHref = await viewAll.getAttribute("href");
    await viewAll.click();
    await page.waitForURL((url) => url.pathname === viewAllHref);
    events = discoveryEvents(captured);
    const va = events.filter((e) => e.eventType === "view_all_click");
    expect(va).toHaveLength(1);
    expect(va[0].targetPath).toBe(viewAllHref);
    expect(va[0].surface).toBe("homepage_section");

    // Double-click the 2nd venue card in the first venue rail
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const card = page.locator('[data-discovery-item^="venue:"][data-discovery-position="1"]').first();
    await card.scrollIntoViewIfNeeded();
    const itemId = (await card.getAttribute("data-discovery-item"))!.split(":")[1];
    await card.locator("a[href]").first().dblclick();
    await page.waitForURL((url) => url.pathname !== "/");
    await page.waitForTimeout(500);
    const clicks = discoveryEvents(captured).filter((e) => e.eventType === "item_click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ itemType: "venue", itemId, position: 1, surface: "homepage_section" });
    // No legacy write from the website.
    expect(captured.some((c) => c.path === "/api/track/venue-discover")).toBe(false);
  });
});

test.describe("Click ↔ impression matching", () => {
  async function clickCard(page: Page, settleMs: number) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // The last venue rail starts below the fold, so its first card isn't already seen at load.
    const card = page.locator('[data-discovery-item^="venue:"][data-discovery-position="0"]').last();
    expect(Object.values(await visibleRatios(page, '[data-discovery-item^="venue:"][data-discovery-position="0"]')).at(-1)).toBe(0);
    const item = (await card.getAttribute("data-discovery-item"))!;
    const placement = (await card.getAttribute("data-discovery-placement"))!;
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(settleMs);
    await card.locator("a[href]").first().click();
    await page.waitForURL((url) => url.pathname !== "/");
    await page.waitForTimeout(800);
    return { item, placement };
  }
  const matchKey = (e: DiscoveryEvent) => `${e.pageViewId}|${eventKey(e)}`;

  test("a click after the card has been seen ≥1s matches its impression (same page view + placement + item)", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    const { item, placement } = await clickCard(page, 1600);
    const events = discoveryEvents(captured);
    const click = events.find((e) => e.eventType === "item_click")!;
    expect(`${eventKey(click)}`).toBe(`${placement}|${item}`);
    const impressions = new Set(events.filter((e) => e.eventType === "item_impression").map(matchKey));
    expect(impressions.has(matchKey(click))).toBe(true);
  });

  test("a click before the 1s threshold is recorded but has no impression (an unmatched click)", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    // Rest on the hero first so the card isn't already in view, then click within ~150ms of it appearing.
    const { item, placement } = await clickCard(page, 150);
    const events = discoveryEvents(captured);
    const click = events.find((e) => e.eventType === "item_click")!;
    expect(`${eventKey(click)}`).toBe(`${placement}|${item}`);
    const impressions = new Set(events.filter((e) => e.eventType === "item_impression").map(matchKey));
    expect(impressions.has(matchKey(click))).toBe(false);
  });
});

test.describe("Search capture", () => {
  test("hero: partial words are not logged; Enter + pause are one row; mode + full total recorded; selection links to the search", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const input = page.getByRole("combobox");
    // Type with 400ms gaps — the old 200ms debounce logged each prefix.
    for (const ch of "wine") {
      await input.press(ch);
      await page.waitForTimeout(400);
    }
    await input.press("Enter");
    await page.waitForTimeout(2000);
    let searches = searchEvents(captured);
    expect(searches.map((s) => s.searchTerm)).toEqual(["wine"]);
    expect(searches[0]).toMatchObject({ surface: "homepage_hero", mode: "happy_hours", origin: "typed", resultCountCapped: false });
    expect(["enter", "pause"]).toContain(searches[0].captureTrigger);

    // Same text in another mode is a separate search.
    await page.getByRole("button", { name: /daily specials/i }).click();
    await page.waitForTimeout(2000);
    searches = searchEvents(captured);
    expect(searches.map((s) => `${s.mode}:${s.searchTerm}`)).toEqual(["happy_hours:wine", "daily_specials:wine"]);

    // Back to Happy Hours; select the first venue suggestion.
    await page.getByRole("button", { name: /happy hours/i }).click();
    await input.click();
    await page.waitForTimeout(800);
    const firstSuggestion = page.locator("#hero-discovery-search-listbox ul").last().getByRole("button").first();
    await firstSuggestion.click();
    await page.waitForURL((url) => url.pathname !== "/");
    await page.waitForTimeout(500);
    const select = discoveryEvents(captured).filter((e) => e.eventType === "suggestion_select");
    expect(select).toHaveLength(1);
    expect(select[0]).toMatchObject({ surface: "homepage_hero", itemType: "venue", position: 0, mode: "happy_hours" });
    expect(String(select[0].itemId)).toMatch(/^[0-9a-f-]{36}$/); // UUID, not the slug
    const ids = searchEvents(captured).map((s) => s.searchId);
    expect(ids).toContain(select[0].searchId);
  });

  test("hero See all → listing page records origin hero_see_all (not a second url search)", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("combobox").fill("patio");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /see all happy hours matching/i }).click();
    await page.waitForURL(/\/website-happy-hours\?q=patio/);
    await page.waitForTimeout(2000);
    const searches = searchEvents(captured);
    expect(searches.map((s) => `${s.surface}:${s.origin}:${s.captureTrigger}`)).toEqual([
      "homepage_hero:typed:see_all",
      "listing_page:hero_see_all:pause",
    ]);
    expect(discoveryEvents(captured).filter((e) => e.eventType === "view_all_click" && e.surface === "homepage_hero")).toHaveLength(1);
  });

  test("listing pages: ?q= is url, typing is typed, Back is history; each page records its mode", async ({ page, context }) => {
    const captured = await interceptTracking(context);

    for (const [path, mode] of [
      ["/website-happy-hours?q=wine", "happy_hours"],
      ["/website-daily-specials?q=wings", "daily_specials"],
      ["/website-events?q=trivia", "events"],
    ] as const) {
      const before = searchEvents(captured).length;
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1800);
      const rows = searchEvents(captured).slice(before);
      expect(rows, path).toHaveLength(1);
      expect(rows[0]).toMatchObject({ surface: "listing_page", mode, origin: "url", captureTrigger: "pause", resultCountCapped: false });
      expect(typeof rows[0].resultCount).toBe("number");
    }

    // Typed on the Happy Hours listing
    await page.goto("/website-happy-hours");
    await page.waitForLoadState("networkidle");
    const box = page.getByRole("textbox", { name: /search happy hours/i });
    await box.pressSequentially("pub", { delay: 300 });
    await page.waitForTimeout(1800);
    let rows = searchEvents(captured);
    expect(rows.at(-1)).toMatchObject({ searchTerm: "pub", origin: "typed", mode: "happy_hours" });
    const countBefore = rows.length;

    // Open a venue, then Back → restored query is a history search
    await page.waitForTimeout(500); // let the URL sync (?q=pub) settle
    const venueLink = page.locator('a[href*="/venue/"], article a[href]').first();
    await venueLink.click();
    await page.waitForURL((url) => !url.pathname.startsWith("/website-happy-hours"));
    await page.goBack();
    await page.waitForURL(/\/website-happy-hours\?q=pub/);
    await page.waitForTimeout(1800);
    rows = searchEvents(captured);
    expect(rows.length).toBe(countBefore + 1);
    expect(rows.at(-1)).toMatchObject({ searchTerm: "pub", origin: "history" });
  });
});

test.describe("Guide discovery tracking", () => {
  test("guide venue block: exposure + impressions keyed by guide id and block", async ({ page, context }) => {
    const captured = await interceptTracking(context);
    // A published venue guide (see the investigation's guide list).
    await page.goto("/central-okanagan/guides/downtown-kelowna-happy-hour-guide");
    await page.waitForLoadState("networkidle");

    const marker = page.locator('[data-discovery-section="g:venues"], [data-discovery-section="g:events"]').first();
    await marker.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForTimeout(300);

    const events = discoveryEvents(captured);
    const exposure = events.find((e) => e.eventType === "section_exposure" && e.surface === "guide");
    expect(exposure).toBeTruthy();
    expect(String(exposure!.guideId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(["venues", "events"]).toContain(exposure!.guideBlock);
    expect(events.some((e) => e.eventType === "item_impression" && e.surface === "guide")).toBe(true);
    expect(captured.some((c) => c.path === "/api/track/venue-discover")).toBe(false);
  });
});
