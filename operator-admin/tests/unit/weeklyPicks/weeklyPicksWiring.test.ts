import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source-level guarantees for the Weekly Picks signup — properties a
 * behavioural test can't see: every placement shares one form/action,
 * analytics carries only the placement, the confirmed page records
 * nothing, and the consumer account entry point is untouched.
 */

const SRC = join(__dirname, "../../../src");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (p: string) => stripComments(readFileSync(join(SRC, p), "utf8"));

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}
const ALL = listFiles(SRC).map((f) => ({ file: relative(SRC, f), code: stripComments(readFileSync(f, "utf8")) }));

const FORM = "app/(website)/weekly-picks/WeeklyPicksSignupForm.tsx";

test("only the Brevo client calls the double opt-in endpoint, and only the shared form calls the action", () => {
  assert.deepEqual(ALL.filter((f) => f.code.includes("doubleOptinConfirmation")).map((f) => f.file), ["lib/brevo/client.ts"]);
  const actionCallers = ALL.filter((f) => /(?<!function )subscribeToWeeklyPicks\(/.test(f.code)).map((f) => f.file);
  assert.deepEqual(actionCallers, [FORM]);
});

test("every placement renders the shared form with a fixed placement id", () => {
  const usages: Array<[string, string]> = [
    ["app/(website)/weekly-picks/page.tsx", 'placement="weekly_picks_page"'],
    ["app/(website)/page.tsx", 'placement="homepage_main"'],
    ["app/(website)/page.tsx", 'placement="homepage_bottom"'],
    ["app/(website)/[market]/guides/[slug]/GuideDetailView.tsx", 'placement="guide_end"'],
  ];
  for (const [file, needle] of usages) assert.ok(read(file).includes(needle), `${file} ${needle}`);
  const formUsers = ALL.filter((f) => /<WeeklyPicksSignupForm\b/.test(f.code)).map((f) => f.file).sort();
  assert.deepEqual(formUsers, ["app/(website)/weekly-picks/WeeklyPicksSection.tsx", "app/(website)/weekly-picks/page.tsx"]);
});

test("analytics: one GA4 event with only the placement; no Vercel trackEvent; confirmed page records nothing", () => {
  const form = read(FORM);
  const calls = form.match(/trackGA4Event\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ['trackGA4Event("weekly_picks_signup_requested", { placement })']);
  assert.ok(!/trackEvent\(/.test(form));
  const confirmed = read("app/(website)/weekly-picks/confirmed/page.tsx");
  assert.ok(!/track(GA4)?Event|sendGAEvent/.test(confirmed));
  assert.ok(/redirect\("\/weekly-picks\/confirmed"\)/.test(confirmed), "query string is stripped server-side");
});

test("consent: one form, no checkbox or sender line; button + notice with Privacy Policy and contact links", () => {
  const form = read(FORM);
  assert.ok(!/type="checkbox"|weekly_picks_consent/.test(form), "no permission checkbox");
  assert.ok(!form.includes("Sent by Happy Hour Compass"), "no visible sender line");
  assert.ok(form.includes(": WEEKLY_PICKS_SIGNUP_BUTTON_LABEL}") && form.includes("{WEEKLY_PICKS_CONSENT_TEXT}"));
  assert.ok(form.includes('href="/privacy"') && form.includes('href="/privacy#contact"'));
  assert.ok(form.includes("aria-describedby={consentNoticeId}"));
  assert.ok(!/weekly_picks_consent|consent/.test(read("app/(website)/weekly-picks/actions.ts")));
  const privacy = read("app/(legal)/privacy/page.tsx");
  assert.ok(privacy.includes('<Section id="contact"') && privacy.includes("1756 Sonora Drive"), "contact anchor and mailing address exist");
});

test("client form never imports server-only modules", () => {
  const form = read(FORM);
  assert.ok(!/from "@\/lib\/turnstile"/.test(form));
  assert.ok(!/from "@\/lib\/weeklyPicks\/signup"/.test(form));
  assert.ok(!/from "@\/lib\/brevo\//.test(form));
});

test("Weekly Picks never touches account identifiers or the blocklist", () => {
  const files = ["lib/weeklyPicks/signup.ts", "lib/weeklyPicks/weeklyPicks.ts", FORM, "app/(website)/weekly-picks/actions.ts"];
  for (const f of files) assert.ok(!/FIRSTNAME|LASTNAME|EXT_ID|WEEKLY_PICKS_(SOURCE|CONSENT_AT|CONSENT_VERSION)|emailBlacklisted|blocklist/i.test(read(f)), f);
  const client = read("lib/brevo/client.ts");
  const fn = client.slice(client.indexOf("export async function requestWeeklyPicksDoubleOptIn"));
  const body = fn.slice(0, fn.indexOf("\nasync function") > 0 ? fn.indexOf("\nasync function") : undefined);
  assert.ok(!/emailBlacklisted|updateEnabled|FIRSTNAME|EXT_ID|attributes/.test(body), "DOI request sends no attributes and never touches the blocklist");
});

test("header: Weekly Picks link on desktop and mobile; Consumer Sign In unchanged", () => {
  const header = read("app/(website)/WebsiteHeader.tsx");
  assert.equal((header.match(/href="\/weekly-picks"/g) ?? []).length, 2);
  assert.equal((header.match(/Consumer Sign In/g) ?? []).length, 2);
  assert.equal((header.match(/href="\/sign-in"/g) ?? []).length, 2);
});
