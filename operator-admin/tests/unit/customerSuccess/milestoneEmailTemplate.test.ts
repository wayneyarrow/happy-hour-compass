import { test } from "node:test";
import assert from "node:assert/strict";
import { VENUE_VIEW_MILESTONES } from "../../../src/lib/customerSuccess/venueViewMilestones";
import { getMilestoneEmailCopy, MILESTONE_EMAIL_CLOSING } from "../../../src/lib/customerSuccess/milestoneEmailCopy";
import { renderVenueViewMilestoneEmail } from "../../../src/lib/customerSuccess/milestoneEmailTemplate";
import { getSiteUrl } from "../../../src/lib/siteUrl";

const SAMPLE = { firstName: "Kelly", venueName: "Buffalo Rouge Brewing Co." };

// ── Supported milestone values ──────────────────────────────────────────────

test("renders successfully for every one of the 7 approved milestones", () => {
  for (const milestone of VENUE_VIEW_MILESTONES) {
    const rendered = renderVenueViewMilestoneEmail({ milestone, ...SAMPLE });
    assert.ok(rendered.html.length > 0);
    assert.ok(rendered.text.length > 0);
  }
});

test("throws for a milestone with no approved copy", () => {
  for (const bad of [0, 75, 999, 6000]) {
    assert.throws(() => renderVenueViewMilestoneEmail({ milestone: bad, ...SAMPLE }));
  }
});

// ── Subject / preview mapping ────────────────────────────────────────────────

test("subject and previewText match the copy module, with {venue} filled in", () => {
  const rendered = renderVenueViewMilestoneEmail({ milestone: 100, ...SAMPLE });
  const copy = getMilestoneEmailCopy(100)!;
  assert.equal(rendered.subject, "\u{1F389} Buffalo Rouge Brewing Co. just reached 100 views");
  assert.equal(rendered.previewText, copy.previewText);
});

test("subject substitutes a DIFFERENT venue name correctly (not hardcoded)", () => {
  const rendered = renderVenueViewMilestoneEmail({
    milestone: 250,
    firstName: "Sam",
    venueName: "The Lantern & Oak",
  });
  assert.equal(rendered.subject, "\u{1F389} 250 views for The Lantern & Oak");
});

// ── Template data rendering ──────────────────────────────────────────────────

test("html contains the greeting, headline, milestone number, label, venue name, and sign-off", () => {
  const rendered = renderVenueViewMilestoneEmail({ milestone: 1000, ...SAMPLE });
  assert.match(rendered.html, /Hi Kelly,/);
  assert.match(rendered.html, /That’s a milestone worth celebrating/);
  assert.match(rendered.html, />1,000</);
  assert.match(rendered.html, />VENUE VIEWS</);
  assert.match(rendered.html, /Buffalo Rouge Brewing Co\. has now reached 1,000 venue views/);
  assert.match(rendered.html, />Wayne</);
  assert.match(rendered.html, />Happy Hour Compass</);
});

test("html carries the closing line and text version mirrors the same content", () => {
  const rendered = renderVenueViewMilestoneEmail({ milestone: 50, ...SAMPLE });
  assert.ok(rendered.html.includes(MILESTONE_EMAIL_CLOSING));
  assert.ok(rendered.text.includes(MILESTONE_EMAIL_CLOSING));
  assert.match(rendered.text, /^Hi Kelly,/);
  assert.match(rendered.text, /Wayne \| Founder\nHappy Hour Compass$/);
});

// ── Draft Two: signature treatment ("Wayne | Founder" + logo) ──────────────

test("signature reads 'Wayne | Founder' with a plain vertical pipe, Happy Hour Compass directly beneath", () => {
  const rendered = renderVenueViewMilestoneEmail({ milestone: 50, ...SAMPLE });

  // HTML: name and title are separate spans on one line, joined by a plain "|".
  assert.match(rendered.html, /<span[^>]*>Wayne<\/span>\s*<span[^>]*> \| Founder<\/span>/);
  // Exactly a plain pipe — not a bullet, slash, dash, or other decorative separator.
  assert.doesNotMatch(rendered.html, /Wayne\s*[•/\-–—]\s*Founder/);

  // "Happy Hour Compass" is the very next paragraph after the Wayne | Founder line.
  const signatureNameIdx = rendered.html.indexOf("Wayne</span>");
  const companyIdx = rendered.html.indexOf(">Happy Hour Compass<");
  assert.ok(signatureNameIdx !== -1 && companyIdx !== -1);
  assert.ok(companyIdx > signatureNameIdx, "Happy Hour Compass must come after the Wayne | Founder line");

  // Plain text mirrors the same two lines, adjacent.
  assert.match(rendered.text, /Wayne \| Founder\nHappy Hour Compass/);
});

test("sign-off name and title default to Wayne / Founder, but are both overridable", () => {
  const defaultSender = renderVenueViewMilestoneEmail({ milestone: 50, ...SAMPLE });
  assert.match(defaultSender.html, />Wayne</);
  assert.match(defaultSender.html, /Founder/);

  const overridden = renderVenueViewMilestoneEmail({
    milestone: 50,
    ...SAMPLE,
    senderFirstName: "Dana",
    senderTitle: "Head of Customer Success",
  });
  assert.match(overridden.html, />Dana</);
  assert.match(overridden.html, /Head of Customer Success/);
  assert.doesNotMatch(overridden.html, />Wayne</);
  assert.doesNotMatch(overridden.html, /\bFounder\b/);
  assert.match(overridden.text, /Dana \| Head of Customer Success/);
});

// ── Draft Two: top logo removed entirely ────────────────────────────────────

test("the email no longer opens with a logo — it opens directly with the greeting", () => {
  for (const milestone of VENUE_VIEW_MILESTONES) {
    const rendered = renderVenueViewMilestoneEmail({ milestone, ...SAMPLE });
    // The old stacked square logo asset must not appear anywhere at all.
    assert.doesNotMatch(rendered.html, /\/logo\.png/, `milestone ${milestone}: the top logo.png must be fully removed`);

    // The greeting is the first piece of visible body content — no <img> tag
    // appears before "Hi Kelly," in the markup.
    const bodyStart = rendered.html.indexOf("<body");
    const greetingIdx = rendered.html.indexOf("Hi Kelly,");
    const firstImgIdx = rendered.html.indexOf("<img");
    assert.ok(greetingIdx > bodyStart, `milestone ${milestone}: greeting must be present in the body`);
    assert.ok(
      firstImgIdx === -1 || firstImgIdx > greetingIdx,
      `milestone ${milestone}: no image (logo) may appear before the greeting`
    );
  }
});

test("preheader hidden div carries the preview text", () => {
  const rendered = renderVenueViewMilestoneEmail({ milestone: 2500, ...SAMPLE });
  const copy = getMilestoneEmailCopy(2500)!;
  const preheaderMatch = rendered.html.match(/display:none[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(preheaderMatch, "expected a hidden preheader div");
  assert.ok(preheaderMatch![1].includes(copy.previewText));
});

// ── XSS / escaping safety ────────────────────────────────────────────────────

test("venue name and first name are HTML-escaped — no raw markup injection", () => {
  const rendered = renderVenueViewMilestoneEmail({
    milestone: 50,
    firstName: '<script>alert(1)</script>',
    venueName: 'Rosie\'s "Bar" & Grill',
  });
  assert.doesNotMatch(rendered.html, /<script>alert\(1\)<\/script>/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.match(rendered.html, /Rosie&#39;s &quot;Bar&quot; &amp; Grill/);
});

// ── No accidental CTA / link insertion ──────────────────────────────────────

test("the rendered email contains no <a> links or buttons of any kind", () => {
  for (const milestone of VENUE_VIEW_MILESTONES) {
    const rendered = renderVenueViewMilestoneEmail({ milestone, ...SAMPLE });
    assert.doesNotMatch(rendered.html, /<a\s/i, `milestone ${milestone} must not contain an <a> tag`);
    assert.doesNotMatch(rendered.html, /href=/i, `milestone ${milestone} must not contain an href`);
    assert.doesNotMatch(rendered.html, /<button/i, `milestone ${milestone} must not contain a <button>`);
  }
});

test("the rendered email contains no plan/upgrade/pricing language", () => {
  for (const milestone of VENUE_VIEW_MILESTONES) {
    const rendered = renderVenueViewMilestoneEmail({ milestone, ...SAMPLE });
    const lower = rendered.html.toLowerCase();
    for (const forbidden of ["upgrade", "pricing", "subscribe", "plan", "unsubscribe"]) {
      assert.ok(!lower.includes(forbidden), `milestone ${milestone} html must not mention "${forbidden}"`);
    }
  }
});

// ── Signature logo: renders, correct asset, absolute email-safe URL ────────

test("the signature horizontal logo renders, using the tightly-cropped production asset, sized exactly 110px", () => {
  const expectedLogoUrl = `${getSiteUrl()}/hhc-logo-horizontal-header.png`;
  assert.match(expectedLogoUrl, /^https?:\/\//, "sanity check: getSiteUrl() itself must resolve to an absolute origin");

  for (const milestone of VENUE_VIEW_MILESTONES) {
    const rendered = renderVenueViewMilestoneEmail({ milestone, ...SAMPLE });

    // Exactly one <img> in the whole email — the signature logo.
    const imgTags = rendered.html.match(/<img\s[^>]*>/g) ?? [];
    assert.equal(imgTags.length, 1, `milestone ${milestone}: exactly one <img> (the signature logo) should be present`);

    // Correct asset — the tightly-cropped horizontal lockup already used by
    // WebsiteHeader.tsx — never the square-canvas hhc-logo-horizontal.png
    // (excessive white padding) and never the old stacked /logo.png.
    assert.match(
      rendered.html,
      /<img src="https?:\/\/[^"]+\/hhc-logo-horizontal-header\.png"/,
      `milestone ${milestone}: signature logo src must be absolute and use hhc-logo-horizontal-header.png`
    );
    assert.doesNotMatch(
      rendered.html,
      /src="\/hhc-logo-horizontal-header\.png"/,
      `milestone ${milestone}: signature logo src must not be a bare relative path`
    );
    assert.ok(
      rendered.html.includes(`src="${expectedLogoUrl}"`),
      `milestone ${milestone}: signature logo src must equal getSiteUrl() + "/hhc-logo-horizontal-header.png"`
    );
    assert.doesNotMatch(
      rendered.html,
      /hhc-logo-horizontal\.png/,
      `milestone ${milestone}: must not use the square-canvas hhc-logo-horizontal.png`
    );

    // Width is exactly 110px (sized down from an initial 140px so it reads
    // as roughly the same visual width as "Happy Hour Compass" above it),
    // height left auto to preserve the asset's native aspect ratio.
    const widthMatch = rendered.html.match(/hhc-logo-horizontal-header\.png"[^>]*width="(\d+)"/);
    assert.ok(widthMatch, `milestone ${milestone}: signature logo must declare an explicit width`);
    const width = Number(widthMatch![1]);
    assert.equal(width, 110, `milestone ${milestone}: signature logo width must be exactly 110px`);
    assert.match(rendered.html, /hhc-logo-horizontal-header\.png"[^>]*width:110px/);
    assert.match(rendered.html, /hhc-logo-horizontal-header\.png"[^>]*height:auto/);
  }
});

// ── Basic email-safety structure ─────────────────────────────────────────────

test("html uses table-based layout and inline styles only — no <style> block, no external stylesheet", () => {
  const rendered = renderVenueViewMilestoneEmail({ milestone: 500, ...SAMPLE });
  assert.doesNotMatch(rendered.html, /<style[\s>]/i);
  assert.doesNotMatch(rendered.html, /<link[^>]*stylesheet/i);
  assert.match(rendered.html, /<table/i);
});
