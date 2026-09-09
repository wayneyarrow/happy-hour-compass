import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Daily Specials — Creation Flow Correction + Impersonation Save Fix"
 * correction task.
 *
 * Part A: the create flow now matches Events' progressive two-step
 * pattern — Step 1 (Title, Type, Schedule) creates an unpublished draft
 * behind "Continue" and stays in the SAME form; Step 2 (everything else,
 * including Image, now reachable because the row exists) finalizes with an
 * UPDATE to that same row, never a second INSERT. Editing an existing row
 * is untouched — it always goes straight to the full editor.
 *
 * Part B: the impersonation save-looked-like-it-silently-failed defect —
 * see getDailySpecialsForActiveVenueAction's own header comment in
 * actions.ts and DailySpecialsManager.tsx's refreshList() comment for the
 * full root-cause writeup. This file pins the authorization sequence of
 * the new read action and confirms Step 1's insert payload can't be used
 * to smuggle in anything Step 1 doesn't actually show.
 *
 * Same no-DOM static-source-verification convention as
 * formUxRegression.test.ts / serverActionsRegression.test.ts — this repo's
 * plain node:test runner has no React Testing Library/jsdom available.
 */

const FORM_PATH = join(__dirname, "../../../src/app/admin/daily-specials/DailySpecialForm.tsx");
const FORM_SOURCE = readFileSync(FORM_PATH, "utf8");

const MANAGER_PATH = join(__dirname, "../../../src/app/admin/daily-specials/DailySpecialsManager.tsx");
const MANAGER_SOURCE = readFileSync(MANAGER_PATH, "utf8");

const ACTIONS_PATH = join(__dirname, "../../../src/app/admin/daily-specials/actions.ts");
const ACTIONS_SOURCE = readFileSync(ACTIONS_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// STEP 1 — only reachable for a brand-new creation, never for Edit
// ─────────────────────────────────────────────────────────────────────────

test("Step 1 (the `if (!currentSpecialId)` branch) is the first branch inside handleSubmit, before any other validation/save", () => {
  const submitIdx = FORM_SOURCE.indexOf("const handleSubmit = async");
  const step1Idx = FORM_SOURCE.indexOf("if (!currentSpecialId) {", submitIdx);
  assert.ok(submitIdx > -1 && step1Idx > -1);
  // Nothing else meaningful (another validation block, another save call)
  // appears between handleSubmit's start and the Step 1 branch check.
  const between = FORM_SOURCE.slice(submitIdx, step1Idx);
  assert.doesNotMatch(between, /await saveDailySpecialAction/);
});

test("initialSpecial (an existing row) hydrates currentSpecialId synchronously via useEffect, so Edit never reaches the Step 1 branch", () => {
  const effectBlock = FORM_SOURCE.slice(
    FORM_SOURCE.indexOf("useEffect(() => {\n    if (!initialSpecial) return;"),
    FORM_SOURCE.indexOf("}, [initialSpecial]);")
  );
  assert.match(effectBlock, /setCurrentSpecialId\(initialSpecial\.id\);/);
});

test("currentSpecialId's initial state is seeded from initialSpecial?.id — Edit starts with it already set, before any render even happens", () => {
  assert.match(
    FORM_SOURCE,
    /const \[currentSpecialId, setCurrentSpecialId\] = useState<string \| null>\(initialSpecial\?\.id \?\? null\);/
  );
});

// ─────────────────────────────────────────────────────────────────────────
// STEP 1 — validates only Title, Type, Schedule
// ─────────────────────────────────────────────────────────────────────────

function extractStep1Block(): string {
  const start = FORM_SOURCE.indexOf("if (!currentSpecialId) {");
  // Ends at the closing of this if-block, right before the Step 2 comment.
  const end = FORM_SOURCE.indexOf("// ── Step 2 (new creation, past Continue) / single-stage Edit: full save");
  return FORM_SOURCE.slice(start, end);
}

test("Step 1 validates Title, Type, and Schedule — the exact three fields it shows", () => {
  const step1 = extractStep1Block();
  assert.match(step1, /if \(!formState\.title\.trim\(\)\) \{/);
  assert.match(step1, /if \(!formState\.offerType\) \{/);
  assert.match(step1, /validateDailySpecialSchedule\(\{/);
});

test("Step 1 never validates content (short summary/description) or time — those fields aren't shown yet", () => {
  const step1 = extractStep1Block();
  assert.doesNotMatch(step1, /validateDailySpecialContent/);
  assert.doesNotMatch(step1, /validateDailySpecialTime/);
});

test("Step 1's save payload hard-codes isPublished: false — Continue can never publish", () => {
  const step1 = extractStep1Block();
  const payloadMatch = step1.match(/const result = await saveDailySpecialAction\(\s*\{([\s\S]*?)\n\s*\},\s*null\s*\);/);
  assert.ok(payloadMatch, "Step 1's saveDailySpecialAction call not found");
  assert.match(payloadMatch![1], /isPublished: false,/);
});

test("Step 1's save payload sends null for every Step-2-only content field, never the real formState value", () => {
  const step1 = extractStep1Block();
  const payloadMatch = step1.match(/const result = await saveDailySpecialAction\(\s*\{([\s\S]*?)\n\s*\},\s*null\s*\);/);
  assert.ok(payloadMatch);
  const body = payloadMatch![1];
  assert.match(body, /shortSummary: null,/);
  assert.match(body, /description: null,/);
  assert.match(body, /conditions: null,/);
  assert.match(body, /timeMode: "unspecified",/);
  assert.match(body, /startTime: null,/);
  assert.match(body, /endMode: "unspecified",/);
  assert.match(body, /endTime: null,/);
});

test("Step 1 always inserts (passes null as the second saveDailySpecialAction argument) — it can never accidentally update an existing row", () => {
  const step1 = extractStep1Block();
  assert.match(step1, /await saveDailySpecialAction\(\s*\{[\s\S]*?\},\s*null\s*\);/);
});

// ─────────────────────────────────────────────────────────────────────────
// STEP 1 — deliberately does NOT call onSaved (the core UX fix)
// ─────────────────────────────────────────────────────────────────────────

test("CRITICAL: Step 1's success path does not call onSaved() — Continue must stay in the same form, not close it", () => {
  const step1 = extractStep1Block();
  const successTail = step1.slice(step1.indexOf('if ("error" in result)'));
  assert.doesNotMatch(successTail, /onSaved\?\.\(/);
});

test("Step 1's success path sets currentSpecialId from the new row's id, transitioning this same component into Step 2", () => {
  const step1 = extractStep1Block();
  const successTail = step1.slice(step1.indexOf('if ("error" in result)'));
  assert.match(successTail, /setCurrentSpecialId\(result\.savedId\);/);
});

test("Step 1's failure path sets the error state and stops — it never silently proceeds", () => {
  const step1 = extractStep1Block();
  const errorBlock = step1.match(/if \("error" in result\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(errorBlock);
  assert.match(errorBlock![1], /setError\(result\.error\);/);
  assert.match(errorBlock![1], /return;/);
  assert.doesNotMatch(errorBlock![1], /setCurrentSpecialId/);
});

// ─────────────────────────────────────────────────────────────────────────
// STEP 2 (new creation) — full save updates the SAME row, calls onSaved
// ─────────────────────────────────────────────────────────────────────────

function extractStep2Block(): string {
  const start = FORM_SOURCE.indexOf(
    "// ── Step 2 (new creation, past Continue) / single-stage Edit: full save"
  );
  const end = FORM_SOURCE.indexOf("// ── Image upload / remove");
  return FORM_SOURCE.slice(start, end);
}

test("Step 2's final save passes currentSpecialId (never null) as the second saveDailySpecialAction argument — an UPDATE, never a second INSERT", () => {
  const step2 = extractStep2Block();
  assert.match(
    step2,
    /const result = await saveDailySpecialAction\(\s*buildSavePayload\(formState, venueId\),\s*currentSpecialId\s*\);/
  );
});

test("Step 2's final save validates schedule, time, AND content before saving — the full validation Step 1 skipped", () => {
  const step2 = extractStep2Block();
  assert.match(step2, /validateDailySpecialSchedule\(\{/);
  assert.match(step2, /validateDailySpecialTime\(\{/);
  assert.match(step2, /validateDailySpecialContent\(\{/);
});

test("Step 2's success path DOES call onSaved() — this is the true completion of creation (or of an edit)", () => {
  const step2 = extractStep2Block();
  const successTail = step2.slice(step2.lastIndexOf('if ("error" in result)'));
  assert.match(successTail, /onSaved\?\.\(result\.savedId\);/);
});

test("Step 2's failure path sets the error state and never calls onSaved — a failed final save must not look like a completed creation", () => {
  const step2 = extractStep2Block();
  const errorBlock = step2.match(/if \("error" in result\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(errorBlock);
  assert.match(errorBlock![1], /setError\(result\.error\);/);
  assert.match(errorBlock![1], /return;/);
  assert.doesNotMatch(errorBlock![1], /onSaved/);
});

// ─────────────────────────────────────────────────────────────────────────
// IMAGE — only reachable in Step 2, never in Step 1
// ─────────────────────────────────────────────────────────────────────────

test("the Image section is not present anywhere in the Step 1 (early-return) JSX", () => {
  const step1ReturnStart = FORM_SOURCE.indexOf("if (!currentSpecialId) {\n    return (");
  const step1ReturnEnd = FORM_SOURCE.indexOf("// ── Step 2 (new creation, past Continue) / single-stage Edit: full editor");
  const step1Jsx = FORM_SOURCE.slice(step1ReturnStart, step1ReturnEnd);
  assert.doesNotMatch(step1Jsx, /Upload image/);
  assert.doesNotMatch(step1Jsx, /handleImageUpload/);
  assert.doesNotMatch(step1Jsx, /imageInputRef/);
});

test("the Image section in the full editor is unconditional (no currentSpecialId && guard) — this branch only ever renders once currentSpecialId already exists", () => {
  const fullEditorIdx = FORM_SOURCE.indexOf(
    "// ── Step 2 (new creation, past Continue) / single-stage Edit: full editor"
  );
  const imageSectionIdx = FORM_SOURCE.indexOf("Upload image", fullEditorIdx);
  assert.ok(imageSectionIdx > -1);
  // The old single-stage form gated this with `{currentSpecialId && (`.
  // Confirm that specific conditional wrapper is gone from the full editor.
  const nearby = FORM_SOURCE.slice(fullEditorIdx, imageSectionIdx);
  assert.doesNotMatch(nearby, /\{currentSpecialId && \(/);
});

test("this is the exact gap the correction task reports fixed: Image is reachable as soon as Step 1's Continue succeeds, not only after a full save-close-reopen cycle", () => {
  // Step 1 ends by setting currentSpecialId and returning (no further
  // action needed from the operator to reach Step 2 — no page reload, no
  // re-selecting the row from the list).
  const step1 = extractStep1Block();
  const successTail = step1.slice(step1.indexOf('if ("error" in result)'));
  assert.match(successTail, /setCurrentSpecialId\(result\.savedId\);/);
  assert.doesNotMatch(successTail, /window\.location/);
  assert.doesNotMatch(successTail, /router\./);
});

// ─────────────────────────────────────────────────────────────────────────
// SHARED FIELDS — Title/Type/Schedule defined once, rendered in both steps
// ─────────────────────────────────────────────────────────────────────────

test("Title, Type, and Schedule JSX are each defined exactly once (titleAndTypeFields / scheduleSection) and reused by both Step 1 and the full editor — not duplicated/drifted copies", () => {
  assert.match(FORM_SOURCE, /const titleAndTypeFields = \(/);
  assert.match(FORM_SOURCE, /const scheduleSection = \(/);
  assert.equal((FORM_SOURCE.match(/\{titleAndTypeFields\}/g) ?? []).length, 2);
  assert.equal((FORM_SOURCE.match(/\{scheduleSection\}/g) ?? []).length, 2);
});

// ─────────────────────────────────────────────────────────────────────────
// SUBMIT BUTTON LABEL — driven by initialSpecial, not currentSpecialId
// ─────────────────────────────────────────────────────────────────────────

test("the full editor's submit button reads \"Create Daily Special\" for a brand-new row (even in Step 2, where currentSpecialId is already set) and \"Save changes\" only when editing an existing row", () => {
  assert.match(
    FORM_SOURCE,
    /\{isSaving \? "Saving…" : initialSpecial \? "Save changes" : "Create Daily Special"\}/
  );
  // The stale currentSpecialId-driven version of this ternary must be gone.
  assert.doesNotMatch(FORM_SOURCE, /currentSpecialId \? "Save changes" : "Create Daily Special"/);
});

test("Step 1's own button always reads \"Continue\" (or \"Creating…\" while saving) — never \"Create Daily Special\"", () => {
  const step1ReturnStart = FORM_SOURCE.indexOf("if (!currentSpecialId) {\n    return (");
  const step1ReturnEnd = FORM_SOURCE.indexOf("// ── Step 2 (new creation, past Continue) / single-stage Edit: full editor");
  const step1Jsx = FORM_SOURCE.slice(step1ReturnStart, step1ReturnEnd);
  assert.match(step1Jsx, /\{isSaving \? "Creating…" : "Continue"\}/);
  assert.doesNotMatch(step1Jsx, /Create Daily Special/);
});

// ─────────────────────────────────────────────────────────────────────────
// CANCEL — only available in Step 1, matching the Events precedent of no
// cancel-and-delete-draft affordance once a row actually exists
// ─────────────────────────────────────────────────────────────────────────

test("Cancel is only rendered in the Step 1 return — no Cancel button exists anywhere in the full editor return", () => {
  const fullEditorStart = FORM_SOURCE.indexOf(
    "// ── Step 2 (new creation, past Continue) / single-stage Edit: full editor"
  );
  const fullEditorJsx = FORM_SOURCE.slice(fullEditorStart);
  assert.doesNotMatch(fullEditorJsx, />\s*Cancel\s*</);
  assert.doesNotMatch(fullEditorJsx, /onClick=\{onCancel\}/);
});

test("no new 'delete this in-progress draft' cleanup affordance was introduced — abandoning Step 2 simply leaves the draft row in the list, same as Events", () => {
  assert.doesNotMatch(FORM_SOURCE, /discard draft/i);
  assert.doesNotMatch(FORM_SOURCE, /delete draft/i);
});

// ─────────────────────────────────────────────────────────────────────────
// MANAGER WIRING — mode stays "creating" through both steps; no premature
// neutral-return/toast between Continue and the final Step 2 save
// ─────────────────────────────────────────────────────────────────────────

test("DailySpecialsManager's key={selectedId ?? \"new\"} does not change between Step 1 and Step 2 of a new creation — selectedId is only set by resolveAfterSave on the FINAL save, so DailySpecialForm never remounts mid-creation and loses its in-progress state", () => {
  assert.match(MANAGER_SOURCE, /key=\{selectedId \?\? "new"\}/);
  // selectedId is set only inside handleSaved (post-refreshList), which is
  // only reachable via onSaved — and Step 1 never calls onSaved (see the
  // FORM_SOURCE tests above), so selectedId cannot change during Step 1.
  assert.match(MANAGER_SOURCE, /const handleSaved = async \(savedSpecialId: string\) => \{/);
});

test("mode remains \"creating\" for the entire lifetime of a new-creation session (Step 1 through Step 2) — it is never set to \"editing\" as a side effect of Continue, unlike EventsManager's equivalent flow", () => {
  // DailySpecialsManager only ever calls setMode("editing") from
  // handleSelectSpecial (choosing a different row from the list) — never
  // from handleSaved's create branch.
  const handleSavedBlock = MANAGER_SOURCE.slice(
    MANAGER_SOURCE.indexOf("const handleSaved = async"),
    MANAGER_SOURCE.indexOf("const handleCancelCreate")
  );
  assert.doesNotMatch(handleSavedBlock, /setMode\("editing"\)/);
});

// ─────────────────────────────────────────────────────────────────────────
// IMPERSONATION — getDailySpecialsForActiveVenueAction uses the SAME
// authorization sequence as save/delete (Part B fix)
// ─────────────────────────────────────────────────────────────────────────

function extractListActionBlock(): string {
  const start = ACTIONS_SOURCE.indexOf("export async function getDailySpecialsForActiveVenueAction");
  return ACTIONS_SOURCE.slice(start);
}

test("getDailySpecialsForActiveVenueAction resolves operator context first, before any DB read", () => {
  const block = extractListActionBlock();
  const ctxIdx = block.indexOf("resolveOperatorContext()");
  const dbIdx = block.indexOf(".from(");
  assert.ok(ctxIdx > -1 && dbIdx > -1 && ctxIdx < dbIdx);
});

test("getDailySpecialsForActiveVenueAction: impersonation's session venue always wins over the caller-supplied venueId — exactly like save/delete", () => {
  const block = extractListActionBlock();
  assert.match(block, /ctx\.isImpersonating \? \(ctx\.sessionVenueId \?\? venueId\) : venueId/);
});

test("getDailySpecialsForActiveVenueAction: normal (non-impersonating) operators must own the target venue — checked against ctx.venues", () => {
  const block = extractListActionBlock();
  assert.match(block, /!ctx\.isImpersonating && !ctx\.venues\.some\(\(v\) => v\.id === targetVenueId\)/);
});

test("getDailySpecialsForActiveVenueAction queries through ctx.supabase (the admin/service-role client during impersonation), not the browser client — this IS the fix", () => {
  const block = extractListActionBlock();
  assert.match(block, /ctx\.supabase\s*\n\s*\.from\("daily_specials"\)/);
});

test("getDailySpecialsForActiveVenueAction scopes its query to the resolved targetVenueId, never a bare/unscoped select", () => {
  const block = extractListActionBlock();
  const queryBlock = block.slice(block.indexOf(".from(\"daily_specials\")"));
  assert.match(queryBlock, /\.eq\("venue_id", targetVenueId\)/);
});

test("getDailySpecialsForActiveVenueAction surfaces a query failure as a structured error, never throws or returns undefined", () => {
  const block = extractListActionBlock();
  assert.match(block, /if \(error\) \{/);
  assert.match(block, /return \{ error: /);
});

// ─────────────────────────────────────────────────────────────────────────
// MANAGER — refreshList calls the action, not the browser Supabase client
// ─────────────────────────────────────────────────────────────────────────

test("DailySpecialsManager's refreshList surfaces a failed read via console.error and leaves the prior list in place, rather than silently clearing it or throwing", () => {
  const refreshListBlock = MANAGER_SOURCE.slice(
    MANAGER_SOURCE.indexOf("const refreshList = async"),
    MANAGER_SOURCE.indexOf("const handleSaved")
  );
  assert.match(refreshListBlock, /if \("error" in result\) \{/);
  assert.match(refreshListBlock, /console\.error/);
  // On error it returns early — setSpecials is not called with an empty list.
  const errorBranch = refreshListBlock.match(/if \("error" in result\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(errorBranch);
  assert.doesNotMatch(errorBranch![1], /setSpecials/);
});

// ─────────────────────────────────────────────────────────────────────────
// SECURITY — Step 1's payload can't be used to redirect the venue or spoof
// seeded/provenance state; that's all still decided server-side
// ─────────────────────────────────────────────────────────────────────────

test("Step 1's payload includes venueId (a hint only) but the server action, not the client, decides the AUTHORITATIVE target venue during impersonation — unchanged from the pre-existing save path", () => {
  const step1 = extractStep1Block();
  assert.match(step1, /venueId,/);
  // The authoritative resolution (ctx.isImpersonating ? ctx.sessionVenueId
  // ... : payload.venueId) lives in actions.ts, not here — confirmed by
  // the serverActionsRegression.test.ts suite already covering that exact
  // line for saveDailySpecialAction, which Step 1 also calls.
  assert.match(ACTIONS_SOURCE, /ctx\.isImpersonating \? \(ctx\.sessionVenueId \?\? payload\.venueId\) : payload\.venueId/);
});

test("Step 1's payload has no is_seeded_special/isSeededSpecial field of any kind — provenance can never be requested by the client, matching the existing save payload's shape", () => {
  const step1 = extractStep1Block();
  const payloadMatch = step1.match(/const result = await saveDailySpecialAction\(\s*\{([\s\S]*?)\n\s*\},\s*null\s*\);/);
  assert.ok(payloadMatch);
  assert.doesNotMatch(payloadMatch![1], /[Ss]eeded/);
});

test("Step 1 sends currentSpecialId=null unconditionally (a literal, not a variable) — it cannot be tricked into targeting an arbitrary existing row id", () => {
  const step1 = extractStep1Block();
  assert.match(step1, /await saveDailySpecialAction\(\s*\{[\s\S]*?\},\s*null\s*\);/);
});
