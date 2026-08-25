import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression coverage for the two Control Panel Google Identity bugs found
 * during the SpearHead Winery investigation:
 *
 *   1. The "Confirm this listing" <form> was nested inside the outer
 *      "Search Google Places" <form> — invalid HTML that made React throw
 *      "A React form was unexpectedly submitted" and silently prevented
 *      confirmVenueGooglePlaceAction from ever running.
 *   2. The search form's name/street/city/province fields were uncontrolled
 *      (`defaultValue`), so React 19's automatic form-reset-after-action
 *      snapped an edited value (e.g. province "Yes" -> "BC") back to the
 *      stale value baked in at first render.
 *
 * This repo has no jsdom/React-Testing-Library/react-test-renderer harness
 * (confirmed: no such dependency exists, and no existing test renders a
 * React component — every test in tests/unit/ exercises plain functions).
 * Adding one is a larger infra decision out of scope for this fix. Instead,
 * these tests apply a small, self-verified, dependency-free HTML tag-nesting
 * scanner directly to GoogleIdentityPanel.tsx's source, and check for the
 * specific `defaultValue`/`value` signatures of bug #2. This is a structural
 * regression guard, not a full interaction test — the interactive behaviors
 * (edited value surviving a real search, confirm actually attaching) are
 * covered by manual staging QA (see the SpearHead fix task's QA report),
 * and would be the natural next step to automate if jsdom/RTL is ever added.
 */

const PANEL_PATH = path.resolve(
  __dirname,
  "../../../src/app/control-panel/venues/[id]/GoogleIdentityPanel.tsx"
);

/**
 * Scans source text for `<form` / `</form>` tokens in document order and
 * returns true if any `<form` token appears while another `<form>` is
 * already open (i.e. a nested form) — the exact defect this test guards
 * against. Ignores everything else about the markup (attributes, other
 * tags), so it can't be fooled by unrelated structure changes.
 */
function hasNestedFormTags(source: string): boolean {
  const tokens = source.match(/<\/?form\b/g) ?? [];
  let depth = 0;
  for (const token of tokens) {
    if (token === "<form") {
      if (depth > 0) return true;
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

// ── Self-verify the scanner against synthetic fixtures ─────────────────────

test("hasNestedFormTags detects a nested <form> (synthetic bad case)", () => {
  const bad = `
    <form action={a}>
      <input />
      <form action={b}>
        <button>Confirm</button>
      </form>
    </form>
  `;
  assert.equal(hasNestedFormTags(bad), true);
});

test("hasNestedFormTags accepts sibling <form> elements (synthetic good case)", () => {
  const good = `
    <form action={a}>
      <input />
    </form>
    <div>
      <form action={b}>
        <button>Confirm</button>
      </form>
    </div>
  `;
  assert.equal(hasNestedFormTags(good), false);
});

test("hasNestedFormTags accepts a file with no forms at all", () => {
  assert.equal(hasNestedFormTags("<div><span>no forms here</span></div>"), false);
});

// ── Regression: the real component file ─────────────────────────────────────

test("GoogleIdentityPanel.tsx contains multiple <form> elements (sanity check)", () => {
  const source = fs.readFileSync(PANEL_PATH, "utf8");
  const formOpens = source.match(/<form\b/g) ?? [];
  // search form, confirm form, exempt form, clear-exemption form
  assert.ok(formOpens.length >= 4, `expected at least 4 <form> elements, found ${formOpens.length}`);
});

test("GoogleIdentityPanel.tsx no longer nests the confirm <form> inside the search <form>", () => {
  const source = fs.readFileSync(PANEL_PATH, "utf8");
  assert.equal(
    hasNestedFormTags(source),
    false,
    "found a <form> nested inside another <form> — this is invalid HTML and breaks " +
      "React's form action dispatch (see the SpearHead investigation's \"Confirm this " +
      "listing\" root cause)"
  );
});

test("GoogleIdentityPanel.tsx search fields are controlled (value=), not uncontrolled (defaultValue=)", () => {
  const source = fs.readFileSync(PANEL_PATH, "utf8");

  // The exact defaultValue-bound fields that caused the province-reversion
  // bug — asserting they're gone guards against reintroducing it.
  for (const stale of [
    "defaultValue={name}",
    "defaultValue={addressLine1",
    "defaultValue={city",
    "defaultValue={region",
  ]) {
    assert.ok(
      !source.includes(stale),
      `expected "${stale}" (uncontrolled input) to be gone from GoogleIdentityPanel.tsx`
    );
  }

  // The search form's 4 fields should now be controlled via local state.
  for (const controlled of [
    "value={searchName}",
    "value={searchStreetAddress}",
    "value={searchCity}",
    "value={searchProvince}",
  ]) {
    assert.ok(
      source.includes(controlled),
      `expected "${controlled}" (controlled input) in GoogleIdentityPanel.tsx`
    );
  }
});

test("GoogleIdentityPanel.tsx still submits the confirm form with the candidate's place_id", () => {
  const source = fs.readFileSync(PANEL_PATH, "utf8");
  assert.match(
    source,
    /name="place_id"\s+value=\{searchState\.candidate\.placeId\}/,
    "confirm form's hidden place_id input should still bind to searchState.candidate.placeId"
  );
  assert.match(
    source,
    /<form action=\{confirmFormAction\}>/,
    "confirm form should still use confirmFormAction"
  );
});
