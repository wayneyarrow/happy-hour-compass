import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Website mobile menu (WebsiteHeader, below xl). Browser behaviour is
 * verified on Staging; these pin the wiring so it can't silently regress.
 */

const header = readFileSync(path.join(process.cwd(), "src/app/(website)/WebsiteHeader.tsx"), "utf8");

test("Escape closes the open mobile menu and returns focus to its toggle", () => {
  const effect = header.slice(header.indexOf("// Escape closes the mobile menu"), header.indexOf("// Lock body scroll"));
  assert.match(effect, /if \(!menuOpen\) return;/);
  assert.match(effect, /e\.key !== "Escape"/);
  assert.match(effect, /setMenuOpen\(false\)/);
  assert.match(effect, /menuButtonRef\.current\?\.focus\(\)/);
  assert.match(effect, /removeEventListener\("keydown"/);
  assert.match(header, /ref=\{menuButtonRef\}\s+type="button"\s+aria-label=\{menuOpen \? "Close navigation menu"/);
});

test("the menu overlay stacks above the venue sticky section bar and below the header", () => {
  const stickyNav = readFileSync(path.join(process.cwd(), "src/app/(website)/[market]/[city]/[slug]/StickyNav.tsx"), "utf8");
  assert.match(stickyNav, /sticky top-16 md:top-\[72px\] z-40 /);
  assert.match(header, /<header\s+className=\{`sticky top-0 z-50 /);
  assert.match(header, /id="website-mobile-menu"[\s\S]{0,120}className="fixed inset-0 z-\[45\] xl:hidden"/);
});
