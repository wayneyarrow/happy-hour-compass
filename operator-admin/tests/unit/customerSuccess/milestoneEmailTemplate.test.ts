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
  assert.match(rendered.text, /Wayne\nHappy Hour Compass$/);
});

test("sign-off name defaults to Wayne, but is overridable", () => {
  const defaultSender = renderVenueViewMilestoneEmail({ milestone: 50, ...SAMPLE });
  assert.match(defaultSender.html, />Wayne</);

  const overridden = renderVenueViewMilestoneEmail({ milestone: 50, ...SAMPLE, senderFirstName: "Dana" });
  assert.match(overridden.html, />Dana</);
  assert.doesNotMatch(overridden.html, />Wayne</);
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

// ── Logo URL must be absolute, email-safe — never a bare relative path ─────

test("the logo <img src> is an absolute URL, not a relative one, in every rendered variant", () => {
  const expectedLogoUrl = `${getSiteUrl()}/logo.png`;
  assert.match(expectedLogoUrl, /^https?:\/\//, "sanity check: getSiteUrl() itself must resolve to an absolute origin");

  for (const milestone of VENUE_VIEW_MILESTONES) {
    const rendered = renderVenueViewMilestoneEmail({ milestone, ...SAMPLE });
    // Same construction as emailLayout()'s logo in src/lib/email.ts — reused,
    // not reinvented. Must never regress to a bare `src="/logo.png"`, which
    // an external email client cannot resolve (no page origin to resolve
    // a relative path against).
    assert.match(rendered.html, /<img src="https?:\/\/[^"]+\/logo\.png"/, `milestone ${milestone}: logo src must be absolute`);
    assert.doesNotMatch(rendered.html, /src="\/logo\.png"/, `milestone ${milestone}: logo src must not be a bare relative path`);
    assert.ok(rendered.html.includes(`src="${expectedLogoUrl}"`), `milestone ${milestone}: logo src must equal getSiteUrl() + "/logo.png"`);
  }
});

// ── Basic email-safety structure ─────────────────────────────────────────────

test("html uses table-based layout and inline styles only — no <style> block, no external stylesheet", () => {
  const rendered = renderVenueViewMilestoneEmail({ milestone: 500, ...SAMPLE });
  assert.doesNotMatch(rendered.html, /<style[\s>]/i);
  assert.doesNotMatch(rendered.html, /<link[^>]*stylesheet/i);
  assert.match(rendered.html, /<table/i);
});
