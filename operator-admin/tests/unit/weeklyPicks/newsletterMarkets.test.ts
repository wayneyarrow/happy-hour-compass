import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETS } from "../../../src/lib/markets";
import { NEWSLETTER_MARKETS, getNewsletterMarket } from "../../../src/lib/weeklyPicks/newsletterMarkets";
import { NEWSLETTER_BREVO_ENV } from "../../../src/lib/brevo/config";
import { getAvailableNewsletterMarket, getNewsletterSignupHref } from "../../../src/lib/weeklyPicks/newsletterAvailability";
import { WEEKLY_PICKS_EYEBROW, WEEKLY_PICKS_PROMISE } from "../../../src/lib/weeklyPicks/weeklyPicks";
import { withBrevoEnv } from "../brevo/support/testEnv";

/**
 * Per-market "Your Happy Hour Plans" newsletters: config parity, the
 * server-side availability switch, market copy, and the surfaces that
 * render a signup (homepage, header, guides, signup/confirmation pages).
 * Brevo request routing per market: tests/unit/brevo/weeklyPicksDoubleOptIn.test.ts;
 * the signup action's market validation: signup.test.ts.
 */

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

test("every newsletter market has Brevo env config, and vice versa; all are active markets", () => {
  assert.deepEqual(NEWSLETTER_MARKETS.map((m) => m.marketId).sort(), Object.keys(NEWSLETTER_BREVO_ENV).sort());
  for (const m of NEWSLETTER_MARKETS) assert.equal(MARKETS.find((x) => x.id === m.marketId)?.status, "active", m.marketId);
});

test("Central Okanagan keeps /weekly-picks, its always-on signup, its copy and its giveaway", () => {
  const co = getNewsletterMarket("central-okanagan")!;
  assert.equal(co.signupPath, "/weekly-picks");
  assert.equal(co.confirmedPath, "/weekly-picks/confirmed");
  assert.equal(co.eyebrow, WEEKLY_PICKS_EYEBROW);
  assert.equal(co.promise, WEEKLY_PICKS_PROMISE);
  assert.equal(co.confirmedText, "Look out for Your Happy Hour Plans in your inbox every Thursday.");
  assert.equal(co.hasGiveaway, true);
  assert.deepEqual(NEWSLETTER_BREVO_ENV["central-okanagan"], {
    enabledEnv: null,
    listIdEnv: "BREVO_WEEKLY_PICKS_LIST_ID",
    templateIdEnv: "BREVO_WEEKLY_PICKS_DOI_TEMPLATE_ID",
  });
});

test("Greater San Diego: own pages, own env vars, no giveaway, no send date or cadence promised", () => {
  const sd = getNewsletterMarket("greater-san-diego")!;
  assert.equal(sd.signupPath, "/greater-san-diego/newsletter");
  assert.equal(sd.confirmedPath, "/greater-san-diego/newsletter/confirmed");
  assert.equal(sd.hasGiveaway, false);
  assert.deepEqual(NEWSLETTER_BREVO_ENV["greater-san-diego"], {
    enabledEnv: "NEWSLETTER_SIGNUP_ENABLED_GREATER_SAN_DIEGO",
    listIdEnv: "BREVO_NEWSLETTER_LIST_ID_GREATER_SAN_DIEGO",
    templateIdEnv: "BREVO_NEWSLETTER_DOI_TEMPLATE_ID_GREATER_SAN_DIEGO",
  });
  const copy = [sd.eyebrow, sd.headline, sd.promise, sd.pageDescription, sd.includedHeading, ...sd.included, sd.acceptedText, sd.confirmedText].join(" ");
  assert.match(copy, /Greater San Diego/);
  assert.match(copy, /first edition/);
  assert.doesNotMatch(copy, /weekly|every|thursday|monday|tuesday|wednesday|friday|saturday|sunday|this week|daily email|giveaway|gift card|train station|kelowna|okanagan|lake country/i);
});

test("availability: Central Okanagan always; San Diego only when its switch is exactly \"true\"; nothing else", () => {
  for (const flag of [undefined, "", "false", "1", "TRUE"]) {
    const restore = withBrevoEnv({ NEWSLETTER_SIGNUP_ENABLED_GREATER_SAN_DIEGO: flag });
    try {
      assert.equal(getNewsletterSignupHref("central-okanagan"), "/weekly-picks");
      assert.equal(getNewsletterSignupHref("greater-san-diego"), null, String(flag));
      assert.equal(getAvailableNewsletterMarket("greater-san-diego"), null);
    } finally {
      restore();
    }
  }
  const restore = withBrevoEnv({ NEWSLETTER_SIGNUP_ENABLED_GREATER_SAN_DIEGO: "true" });
  try {
    assert.equal(getNewsletterSignupHref("greater-san-diego"), "/greater-san-diego/newsletter");
    assert.equal(getNewsletterSignupHref("central-okanagan"), "/weekly-picks");
    for (const id of ["greater-vancouver", "calgary", "nowhere", "", null, undefined, "__proto__"]) {
      assert.equal(getNewsletterSignupHref(id), null, String(id));
    }
  } finally {
    restore();
  }
});

// ─── Wiring ─────────────────────────────────────────────────────────────────

test("homepage bands, guide footer and sitemap use the page's own market availability", () => {
  const home = read("app/(website)/homepage/MarketHomepage.tsx");
  assert.match(home, /const newsletter = getAvailableNewsletterMarket\(marketSlug\);\s*if \(!newsletter\)/);
  assert.equal((home.match(/<WeeklyPicksSection placement="homepage_(main|bottom)" newsletter=\{newsletter\}/g) ?? []).length, 2);
  const guide = read("app/(website)/[market]/guides/[slug]/GuideDetailView.tsx");
  assert.match(guide, /const newsletter = getAvailableNewsletterMarket\(guide\.marketSlug\);/);
  assert.match(guide, /\{newsletter && \(\s*<WeeklyPicksSection placement="guide_end" newsletter=\{newsletter\}/);
  assert.match(read("app/sitemap.ts"), /getAvailableNewsletterMarket\(m\.marketId\)/);
});

test("every header is given its market's server-resolved newsletter link; the header decides nothing itself", () => {
  for (const f of ["app/(website)/layout.tsx", "app/(consumer-auth)/layout.tsx", "app/(website)/homepage/HomepageDiscoveryShell.tsx"]) {
    assert.match(read(f), /newsletterHref=\{getNewsletterSignupHref\(market\.id\)\}/, f);
  }
  const header = read("app/(website)/WebsiteHeader.tsx");
  assert.doesNotMatch(header, /weeklyPicks|newsletterAvailability|weekly-picks/);
});

test("signup pages: giveaway only where the market has one; market pages 404 unless available", () => {
  const content = read("app/(website)/weekly-picks/NewsletterSignupPageContent.tsx");
  assert.match(content, /\{showGiveaway && newsletter\.hasGiveaway && <GiveawayCallout \/>\}/);
  const page = read("app/(website)/[market]/newsletter/page.tsx");
  assert.match(page, /const available = getAvailableNewsletterMarket\(market\);\s*if \(!available\) notFound\(\);/);
  assert.match(page, /if \(known\.signupPath !== `\/\$\{market\}\/newsletter`\) permanentRedirect\(known\.signupPath\);/);
  assert.match(page, /newsletter\.hasGiveaway && isGiveawayCalloutVisible/);
  assert.match(read("app/(website)/weekly-picks/page.tsx"), /getNewsletterMarket\("central-okanagan"\)/);
});

test("the form submits its market; the server validates it before Turnstile and Brevo", () => {
  const form = read("app/(website)/weekly-picks/WeeklyPicksSignupForm.tsx");
  assert.match(form, /<input type="hidden" name="market" value=\{newsletter\.marketId\} \/>/);
  assert.doesNotMatch(form, /newsletterAvailability|brevo/);
  assert.match(read("app/(website)/weekly-picks/actions.ts"), /market: formData\.get\("market"\)/);
  const signup = read("lib/weeklyPicks/signup.ts");
  assert.ok(signup.indexOf("deps.availableMarket(") < signup.indexOf("deps.verifyTurnstile("));
  assert.match(signup, /redirectionUrl: `\$\{deps\.siteUrl\(\)\}\$\{market\.confirmedPath\}`/);
  assert.match(signup, /marketId: market\.marketId/);
  assert.match(read("lib/brevo/client.ts"), /const config = getNewsletterBrevoConfig\(params\.marketId\);/);
});
