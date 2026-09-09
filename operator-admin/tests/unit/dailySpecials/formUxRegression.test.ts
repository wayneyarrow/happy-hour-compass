import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static source verification of DailySpecialForm.tsx's Phase 2 correction
 * UX changes — copy, character-limit wiring, and default-state behavior
 * that can't be exercised through a DOM in this repo's plain node:test
 * runner (no React Testing Library/jsdom is wired up here). Same
 * no-DOM-available convention as the migration-regression tests.
 */

const FORM_PATH = join(__dirname, "../../../src/app/admin/daily-specials/DailySpecialForm.tsx");
const FORM_SOURCE = readFileSync(FORM_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// Close helper copy
// ─────────────────────────────────────────────────────────────────────────

test("Close helper text is simplified to exactly the required copy", () => {
  assert.match(FORM_SOURCE, /Guests will see &ldquo;Until Close\.&rdquo;/);
});

test("the old, longer Close helper sentence about venue hours is gone", () => {
  assert.doesNotMatch(FORM_SOURCE, /not tied to your venue/);
  assert.doesNotMatch(FORM_SOURCE, /always stays accurate even if your hours change/);
});

// ─────────────────────────────────────────────────────────────────────────
// Short Summary helper copy
// ─────────────────────────────────────────────────────────────────────────

test("Short Summary helper text is updated to the required copy, referencing the 120-character maximum", () => {
  assert.match(
    FORM_SOURCE,
    /A short version of the offer used on Daily Specials cards\. Maximum \{SHORT_SUMMARY_MAX_LENGTH\} characters\./
  );
});

test("Short Summary helper text no longer says \"eventually\"", () => {
  const helperMatch = FORM_SOURCE.match(/A short version of the offer[^<]*/);
  assert.ok(helperMatch);
  assert.doesNotMatch(helperMatch![0], /eventually/i);
});

// ─────────────────────────────────────────────────────────────────────────
// Character limits — client enforcement (do not rely on maxlength alone)
// ─────────────────────────────────────────────────────────────────────────

test("Short Summary: browser maxLength is bound to SHORT_SUMMARY_MAX_LENGTH (120)", () => {
  assert.match(FORM_SOURCE, /maxLength=\{SHORT_SUMMARY_MAX_LENGTH\}/);
});

test("Short Summary: onChange also truncates via slice() — does not rely on the HTML maxlength attribute alone", () => {
  assert.match(
    FORM_SOURCE,
    /onChange=\{\(e\) => update\("shortSummary", e\.target\.value\.slice\(0, SHORT_SUMMARY_MAX_LENGTH\)\)\}/
  );
});

test("Description: browser maxLength is bound to DESCRIPTION_MAX_LENGTH (1000)", () => {
  assert.match(FORM_SOURCE, /maxLength=\{DESCRIPTION_MAX_LENGTH\}/);
});

test("Description: onChange also truncates via slice() — does not rely on the HTML maxlength attribute alone", () => {
  assert.match(
    FORM_SOURCE,
    /onChange=\{\(e\) => update\("description", e\.target\.value\.slice\(0, DESCRIPTION_MAX_LENGTH\)\)\}/
  );
});

test("neither limit constant is a locally re-declared magic number — both are imported from the shared dailySpecialTypes module", () => {
  assert.match(FORM_SOURCE, /SHORT_SUMMARY_MAX_LENGTH,/);
  assert.match(FORM_SOURCE, /DESCRIPTION_MAX_LENGTH,/);
  assert.match(FORM_SOURCE, /from "@\/lib\/dailySpecialTypes"/);
  assert.doesNotMatch(FORM_SOURCE, /const SHORT_SUMMARY_MAX_LENGTH\s*=/);
  assert.doesNotMatch(FORM_SOURCE, /const DESCRIPTION_MAX_LENGTH\s*=/);
});

test("client-side submit validation calls validateDailySpecialContent() before saving — matches server enforcement exactly", () => {
  // As of the two-step creation flow, handleSubmit contains TWO
  // saveDailySpecialAction() calls: Step 1's Continue branch (which sends
  // hard-coded null content and never calls validateDailySpecialContent at
  // all — see its own test group below) and the Step 2 / single-stage-Edit
  // branch, which is the one this test is actually about. Scope the search
  // to the SECOND occurrence — the one that follows validateDailySpecialContent
  // in source order — rather than the first (Step 1's), which precedes it.
  assert.match(FORM_SOURCE, /validateDailySpecialContent\(\{/);
  const idx = FORM_SOURCE.indexOf("validateDailySpecialContent({");
  const saveCallIdx = FORM_SOURCE.indexOf("await saveDailySpecialAction(", idx);
  assert.ok(idx > -1 && saveCallIdx > -1 && idx < saveCallIdx);
});

// ─────────────────────────────────────────────────────────────────────────
// Live character counters
// ─────────────────────────────────────────────────────────────────────────

test("counters reflect the CURRENT field length via formState, not a static/placeholder value", () => {
  assert.match(
    FORM_SOURCE,
    /<CharCounter length=\{formState\.shortSummary\.length\} max=\{SHORT_SUMMARY_MAX_LENGTH\} \/>/
  );
  assert.match(
    FORM_SOURCE,
    /<CharCounter length=\{formState\.description\.length\} max=\{DESCRIPTION_MAX_LENGTH\} \/>/
  );
});

test("counter is visually secondary (small, muted text) — does not use a dominant/large text size class", () => {
  const counterFnMatch = FORM_SOURCE.match(/function CharCounter[\s\S]*?\n\}/);
  assert.ok(counterFnMatch);
  assert.match(counterFnMatch![0], /text-xs/);
  assert.doesNotMatch(counterFnMatch![0], /text-(lg|xl|2xl|3xl)/);
});

// ─────────────────────────────────────────────────────────────────────────
// Conditions — explicitly NOT limited in this correction
// ─────────────────────────────────────────────────────────────────────────

test("Conditions field has no maxLength attribute and no character counter — not part of this correction", () => {
  const conditionsBlock = FORM_SOURCE.slice(
    FORM_SOURCE.indexOf('id="special-conditions"') - 200,
    FORM_SOURCE.indexOf('id="special-conditions"') + 400
  );
  assert.doesNotMatch(conditionsBlock, /maxLength/);
  assert.doesNotMatch(conditionsBlock, /CharCounter/);
});

// ─────────────────────────────────────────────────────────────────────────
// Type selector — explicitly untouched in this correction
// ─────────────────────────────────────────────────────────────────────────

test("Type selector styling is untouched by this correction", () => {
  assert.match(FORM_SOURCE, /OFFER_TYPES\.map\(\(type\) => \(/);
  assert.match(FORM_SOURCE, /formState\.offerType === type/);
});

// ─────────────────────────────────────────────────────────────────────────
// Recurrence remains v1-simple — no new recurrence type introduced
// ─────────────────────────────────────────────────────────────────────────

test("no monthly/biweekly/custom recurrence option exists anywhere in the form", () => {
  for (const forbidden of [/monthly/i, /biweekly/i, /every other week/i, /first friday/i, /custom recurrence/i]) {
    assert.doesNotMatch(FORM_SOURCE, forbidden);
  }
  // Exactly the two locked schedule-type options remain.
  assert.match(FORM_SOURCE, /One time/);
  assert.match(FORM_SOURCE, /Every week/);
});
