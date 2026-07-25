import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Opens a header-triggered modal, going through the mobile hamburger menu on
 * narrow viewports. Scoped to the header's nav landmark (desktop:
 * "Main navigation", mobile: "Mobile navigation") because the footer renders
 * its own independent trigger with the same accessible name (e.g. "Add Your
 * Venue" appears in both the header and the footer as separate entry points
 * into separate modal instances) — an unscoped page-wide locator is
 * ambiguous.
 */
async function openHeaderTrigger(page: Page, label: string) {
  await (await headerTrigger(page, label)).click();
}

/**
 * Same header-trigger scoping as openHeaderTrigger() — opens the mobile
 * hamburger menu first on narrow viewports — but returns the Locator
 * instead of clicking it. Needed when a test has to assert focus returns
 * to this exact element later (e.g. after closing a modal it opened),
 * since a bare click() throws away the reference.
 */
async function headerTrigger(page: Page, label: string) {
  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 0) < 768;
  if (isMobile) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    return page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: label, exact: true });
  }
  return page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: label, exact: true });
}

test.describe("Acquisition forms — open without submitting", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Suggest a Venue modal opens with a usable form", async ({ page }) => {
    await openHeaderTrigger(page, "Suggest a Venue");
    const dialog = page.getByRole("dialog", { name: "Suggest a Venue" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Business name").fill("Audit Test Venue");
    await dialog.getByLabel("City").fill("Kelowna");
    await expect(dialog.getByRole("button", { name: /submit suggestion/i })).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("Add Your Venue modal opens with a usable form", async ({ page }) => {
    await openHeaderTrigger(page, "Add Your Venue");
    const dialog = page.getByRole("dialog", { name: "Add Your Venue" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Business name").fill("Audit Test Venue");
    await expect(dialog.getByRole("button", { name: /find my business/i })).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("Contact Us modal opens from the footer with a usable form", async ({ page }) => {
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    await footer.getByRole("button", { name: "Contact", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Contact Us" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Email").fill("audit-test@example.com");
    await dialog.getByLabel("Message").fill("Automated browser compatibility audit — not a real inquiry.");
    await expect(dialog.getByRole("button", { name: /send message/i })).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("Claim Your Venue entry point loads", async ({ page }) => {
    await page.goto("/claim-your-venue");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/claim your venue/i);
    await expect(page.getByRole("link", { name: /find my venue/i })).toBeVisible();
  });

  test("Claim This Venue modal opens from an unclaimed venue's page, if one exists", async ({ page }) => {
    await page.goto("/website-happy-hours");
    const card = page.locator("a").filter({ has: page.getByRole("heading", { level: 3 }) }).first();
    if (!(await card.count())) {
      test.skip(true, "No venues available for this market at test time.");
    }
    await card.click();

    const claimTrigger = page.getByRole("button", { name: /claim this venue/i });
    if (!(await claimTrigger.count())) {
      test.skip(true, "First venue found is already claimed — no Claim CTA to test.");
    }
    await claimTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Claim This Venue" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /submit claim/i })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
  });
});

test.describe("AcquisitionModal — focus management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  // Uses the Add Your Venue modal's default "form" step specifically — it's
  // the only acquisition-form step with no Turnstile widget, so the set of
  // focusable elements inside the panel is fixed and doesn't depend on the
  // Cloudflare challenge script finishing (network-dependent, and known
  // unreliable in this sandboxed environment — see support/fixtures.ts).
  test("focus enters the modal, Tab/Shift+Tab stay trapped inside it (including from the initial focus target), and Escape restores focus to the trigger", async ({ page }) => {
    const trigger = await headerTrigger(page, "Add Your Venue");
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Add Your Venue" });
    await expect(dialog).toBeVisible();

    // Focus moves into the panel on open. `role="dialog"` sits on the
    // outer fixed-position wrapper; the actual focus target is the inner
    // `tabIndex={-1}` panel div one level in.
    const panel = dialog.locator('div[tabindex="-1"]');
    await expect(panel).toBeFocused();

    // Initial focus lands on the panel container itself (not a real
    // focusable descendant), which is exactly the case a naive
    // first/last-only trap implementation misses: sequential focus
    // navigation treats a focused container as positioned before its own
    // children, so an unguarded Shift+Tab here moves backward out of the
    // panel to whatever precedes it in the document instead of wrapping to
    // the panel's last focusable element.
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("link", { name: "Privacy Policy" })).toBeFocused();

    // From the last element, Tab wraps back around to the first (Close).
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();

    // Escape closes the modal…
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // …and focus returns to the exact element that opened it, not just
    // "somewhere on the page" — keyboard users don't lose their place.
    // Desktop only: on mobile the trigger lives inside the hamburger
    // drawer, and clicking it closes that drawer (unmounting the button)
    // in the same state update that opens the modal — there is no
    // persistent element left in the DOM to restore focus to by the time
    // AcquisitionModal's effect captures document.activeElement. That's an
    // inherent consequence of the mobile menu-closes-on-select pattern
    // (unrelated to this modal's focus-restore logic), not something this
    // test can meaningfully assert on narrow viewports.
    const viewport = page.viewportSize();
    const isDesktop = (viewport?.width ?? 0) >= 768;
    if (isDesktop) {
      await expect(trigger).toBeFocused();
    }
  });

  test("clicking the backdrop and the explicit Close button both close the modal", async ({ page }) => {
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    await footer.getByRole("button", { name: "Contact", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Contact Us" });
    await expect(dialog).toBeVisible();

    // Backdrop click (outside the panel) closes it — desktop only. Below
    // the modal's own `md:` breakpoint the panel is full-screen by design
    // (AcquisitionModal.tsx: "Mobile: full-screen dialog"), so there is no
    // exposed backdrop area a pointer could reach; that layout is covered
    // separately in the responsive/visual specs, not here.
    const viewport = page.viewportSize();
    const isDesktop = (viewport?.width ?? 0) >= 768;
    if (isDesktop) {
      await page.mouse.click(5, 5);
      await expect(dialog).not.toBeVisible();
      await footer.getByRole("button", { name: "Contact", exact: true }).click();
      await expect(dialog).toBeVisible();
    }

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe("Acquisition form validation accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  // Representative case: Add Your Venue's default "form" step validates
  // client-side (no server round trip — `noValidate` + a plain onSubmit
  // handler), so this exercises the real FieldError/aria wiring without
  // triggering a network call or side effect.
  test("empty required fields get aria-invalid + aria-describedby wired to a role=alert message, and a filled field is left unmarked", async ({ page }) => {
    await openHeaderTrigger(page, "Add Your Venue");
    const dialog = page.getByRole("dialog", { name: "Add Your Venue" });
    await expect(dialog).toBeVisible();

    // Fill in exactly one field; leave the rest empty.
    await dialog.getByLabel("Business name").fill("Accessibility Audit Venue");
    await dialog.getByRole("button", { name: "Find my business" }).click();

    // The filled field must not be incorrectly flagged.
    const businessName = dialog.getByLabel("Business name");
    await expect(businessName).not.toHaveAttribute("aria-invalid", "true");
    await expect(businessName).not.toHaveAttribute("aria-describedby");

    // An empty required field is flagged, describedby points at a real,
    // unique element, and that element announces via role=alert.
    const streetAddress = dialog.getByLabel("Street address");
    await expect(streetAddress).toHaveAttribute("aria-invalid", "true");
    const describedById = await streetAddress.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const errorEl = dialog.locator(`#${describedById}`);
    await expect(errorEl).toHaveCount(1); // no duplicate ids
    await expect(errorEl).toHaveAttribute("role", "alert");
    await expect(errorEl).toHaveText("Required");

    // No duplicate ids anywhere in the dialog.
    const dupIds = await dialog.evaluate((root) => {
      const ids = Array.from(root.querySelectorAll("[id]")).map((el) => el.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(dupIds).toEqual([]);
  });
});
