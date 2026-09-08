import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of src/app/admin/daily-specials/actions.ts and
 * imageActions.ts — same no-live-session convention as
 * tests/unit/migrations/*.test.ts: saveEventAction/deleteEventAction
 * themselves have no direct unit tests anywhere in this codebase either
 * (resolveOperatorContext() has no DI seam), so the honest way to pin
 * these files' safety-critical invariants is static source inspection,
 * exactly like this suite already does for migration SQL. The actual
 * DECISION logic (who gets authorized) is separately covered by real,
 * executable unit tests against the extracted pure function these actions
 * call — see authorization.test.ts and src/lib/dailySpecialAuthorization.ts.
 * This file exists to pin everything ELSE that only exists in the wiring:
 * that the action reads its "current row" fresh from the database rather
 * than trusting the payload, that ownership/impersonation scoping matches
 * the Events precedent, and that provenance fields are never client-writable.
 */

const ACTIONS_PATH = join(__dirname, "../../../src/app/admin/daily-specials/actions.ts");
const ACTIONS_SOURCE = readFileSync(ACTIONS_PATH, "utf8");

const IMAGE_ACTIONS_PATH = join(__dirname, "../../../src/app/admin/daily-specials/imageActions.ts");
const IMAGE_ACTIONS_SOURCE = readFileSync(IMAGE_ACTIONS_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// actions.ts — save
// ─────────────────────────────────────────────────────────────────────────

test("actions.ts is a server action module", () => {
  assert.match(ACTIONS_SOURCE, /^"use server";/);
});

test("resolves operator context first, before any DB read/write", () => {
  const ctxIdx = ACTIONS_SOURCE.indexOf("resolveOperatorContext()");
  const firstDbCallIdx = ACTIONS_SOURCE.indexOf(".from(");
  assert.ok(ctxIdx > -1, "resolveOperatorContext() call not found");
  assert.ok(ctxIdx < firstDbCallIdx, "a DB call appears before resolveOperatorContext()");
});

test("impersonation's session venue always wins over the payload's venueId", () => {
  assert.match(
    ACTIONS_SOURCE,
    /ctx\.isImpersonating \? \(ctx\.sessionVenueId \?\? payload\.venueId\) : payload\.venueId/
  );
});

test("normal (non-impersonating) operators must own the target venue — checked against ctx.venues", () => {
  assert.match(
    ACTIONS_SOURCE,
    /!ctx\.isImpersonating && !ctx\.venues\.some\(\(v\) => v\.id === targetVenueId\)/
  );
});

test("venue plan is resolved via getVenuePlanCode(targetVenueId) — never a bare operator-level plan", () => {
  assert.match(ACTIONS_SOURCE, /getVenuePlanCode\(targetVenueId\)/);
  assert.doesNotMatch(ACTIONS_SOURCE, /ctx\.operator\?\.plan/);
});

test("support mode is derived strictly as ctx.isImpersonating && !ctx.operator (Case B only)", () => {
  assert.match(ACTIONS_SOURCE, /ctx\.isImpersonating && !ctx\.operator/);
});

test("CRITICAL: on edit, the current row is read FRESH from the database (is_seeded_special, schedule_type) before authorization — never derived from the incoming payload", () => {
  // The select must read is_seeded_special/schedule_type from the DB,
  // scoped to this id AND this venue.
  assert.match(
    ACTIONS_SOURCE,
    /\.select\("is_seeded_special, schedule_type"\)\s*\n\s*\.eq\("id", currentSpecialId\)\s*\n\s*\.eq\("venue_id", targetVenueId\)/
  );
});

test("CRITICAL: the payload type has no is_seeded_special / source_url / last_verified_at fields at all", () => {
  const payloadTypeMatch = ACTIONS_SOURCE.match(
    /export type DailySpecialSavePayload = \{([\s\S]*?)\n\};/
  );
  assert.ok(payloadTypeMatch, "DailySpecialSavePayload type not found");
  const body = payloadTypeMatch![1];
  assert.doesNotMatch(body, /isSeededSpecial/);
  assert.doesNotMatch(body, /sourceUrl/);
  assert.doesNotMatch(body, /lastVerifiedAt/);
});

test("CRITICAL: is_seeded_special is only ever written on INSERT, computed server-side via shouldStampSeededOnCreate() — never read from payload, never touched on UPDATE", () => {
  assert.match(ACTIONS_SOURCE, /is_seeded_special: shouldStampSeededOnCreate\(/);
  assert.doesNotMatch(ACTIONS_SOURCE, /payload\.isSeededSpecial/);
  assert.doesNotMatch(ACTIONS_SOURCE, /payload\.is_seeded_special/);

  // The UPDATE branch's `fields` object (shared by both insert and update)
  // must not itself set is_seeded_special — only the INSERT's own object
  // literal below does, via the spread of `fields` plus the extra key.
  const fieldsBlockMatch = ACTIONS_SOURCE.match(/const fields = \{([\s\S]*?)\n  \};/);
  assert.ok(fieldsBlockMatch, "fields object not found");
  assert.doesNotMatch(fieldsBlockMatch![1], /is_seeded_special/);
});

test("source_url / last_verified_at are never written anywhere in the save action", () => {
  assert.doesNotMatch(ACTIONS_SOURCE, /source_url:/);
  assert.doesNotMatch(ACTIONS_SOURCE, /last_verified_at:/);
});

test("recurring entitlement is enforced via authorizeDailySpecialSave() before the row is written", () => {
  const authIdx = ACTIONS_SOURCE.indexOf("authorizeDailySpecialSave(");
  const insertIdx = ACTIONS_SOURCE.indexOf(".insert([{");
  const updateIdx = ACTIONS_SOURCE.indexOf(".update({ ...fields");
  assert.ok(authIdx > -1);
  assert.ok(authIdx < insertIdx);
  assert.ok(authIdx < updateIdx);
});

test("content/schedule/time are validated with the pure validators before authorization", () => {
  assert.match(ACTIONS_SOURCE, /validateDailySpecialSchedule\(/);
  assert.match(ACTIONS_SOURCE, /validateDailySpecialTime\(/);
  assert.match(ACTIONS_SOURCE, /validateDailySpecialContent\(/);
});

test("Phase 2 correction: content validation (short summary / description length) runs before the recurring-entitlement check, same as schedule/time validation", () => {
  // Match the real CALL sites specifically (opening an object-literal
  // argument, "...({") — not the doc-comment header, which mentions
  // authorizeDailySpecialSave() by name (empty parens, no call) while
  // explaining the save sequence in prose.
  const contentIdx = ACTIONS_SOURCE.indexOf("validateDailySpecialContent({");
  const authIdx = ACTIONS_SOURCE.indexOf("authorizeDailySpecialSave({");
  assert.ok(contentIdx > -1 && authIdx > -1);
  assert.ok(contentIdx < authIdx);
});

test("update scoped by both id AND venue_id — never id alone", () => {
  assert.match(
    ACTIONS_SOURCE,
    /\.update\(\{ \.\.\.fields, updated_at: new Date\(\)\.toISOString\(\) \}, \{ count: "exact" \}\)\s*\n\s*\.eq\("id", currentSpecialId\)\s*\n\s*\.eq\("venue_id", targetVenueId\)/
  );
});

test("update verifies a nonzero row count rather than assuming success (Postgrest doesn't error on a 0-row update)", () => {
  assert.match(ACTIONS_SOURCE, /if \(!count\) \{/);
});

// ─────────────────────────────────────────────────────────────────────────
// actions.ts — delete
// ─────────────────────────────────────────────────────────────────────────

// deleteDailySpecialAction is defined before saveDailySpecialAction in
// actions.ts — bound the slice to the NEXT "export async function" (or
// end of file) so these assertions only inspect delete's own body, not
// everything that follows it in the file.
function extractDeleteBlock(): string {
  const start = ACTIONS_SOURCE.indexOf("export async function deleteDailySpecialAction");
  const nextFnIdx = ACTIONS_SOURCE.indexOf("export async function", start + 1);
  return nextFnIdx === -1 ? ACTIONS_SOURCE.slice(start) : ACTIONS_SOURCE.slice(start, nextFnIdx);
}

test("delete resolves operator context and target venue the same way save does", () => {
  const deleteBlock = extractDeleteBlock();
  assert.match(deleteBlock, /resolveOperatorContext\(\)/);
  assert.match(deleteBlock, /ctx\.isImpersonating \? \(ctx\.sessionVenueId \?\? venueId\) : venueId/);
  assert.match(deleteBlock, /!ctx\.isImpersonating && !ctx\.venues\.some/);
});

test("delete is scoped by both id AND venue_id, verifies nonzero row count, and performs no plan/entitlement check", () => {
  const deleteBlock = extractDeleteBlock();
  assert.match(deleteBlock, /\.eq\("id", specialId\)/);
  assert.match(deleteBlock, /\.eq\("venue_id", targetVenueId\)/);
  assert.match(deleteBlock, /if \(!count\) \{/);
  assert.doesNotMatch(deleteBlock, /getVenuePlanCode/);
  assert.doesNotMatch(deleteBlock, /authorizeDailySpecialSave/);
});

test("no slug/detail-page/route logic anywhere in the actions module", () => {
  assert.doesNotMatch(ACTIONS_SOURCE, /\bslug\b/i);
});

// ─────────────────────────────────────────────────────────────────────────
// imageActions.ts
// ─────────────────────────────────────────────────────────────────────────

test("image actions reuse the existing venue-images bucket — no new Storage bucket", () => {
  assert.match(IMAGE_ACTIONS_SOURCE, /const BUCKET = "venue-images"/);
});

test("upload path follows daily-specials/{specialId}/{uuid}.jpg, mirroring events/{eventId}/{uuid}.jpg", () => {
  assert.match(
    IMAGE_ACTIONS_SOURCE,
    /const path = `daily-specials\/\$\{specialId\}\/\$\{crypto\.randomUUID\(\)\}\.jpg`/
  );
});

test("upload uses a fresh UUID every time (upsert: false) — a replace is always a new object, never an overwrite", () => {
  assert.match(IMAGE_ACTIONS_SOURCE, /upsert: false/);
});

test("upload sets a 1-year cache-control, matching the event image convention", () => {
  assert.match(IMAGE_ACTIONS_SOURCE, /cacheControl: "31536000"/);
});

test("both upload and remove resolve operator context and enforce venue ownership before touching storage or the DB", () => {
  for (const fn of ["uploadDailySpecialImageAction", "removeDailySpecialImageAction"]) {
    const block = IMAGE_ACTIONS_SOURCE.slice(IMAGE_ACTIONS_SOURCE.indexOf(`export async function ${fn}`));
    const nextFnIdx = block.indexOf("export async function", 1);
    const scoped = nextFnIdx === -1 ? block : block.slice(0, nextFnIdx);
    assert.match(scoped, /resolveOperatorContext\(\)/, `${fn} missing resolveOperatorContext`);
    assert.match(
      scoped,
      /ctx\.isImpersonating \? \(ctx\.sessionVenueId \?\? venueId\) : venueId/,
      `${fn} missing impersonation session-venue precedence`
    );
    assert.match(
      scoped,
      /!ctx\.isImpersonating && !ctx\.venues\.some/,
      `${fn} missing venue-ownership check`
    );
  }
});

test("upload verifies a nonzero DB update row count and cleans up the orphaned NEW-upload object on failure", () => {
  const uploadBlock = IMAGE_ACTIONS_SOURCE.slice(
    IMAGE_ACTIONS_SOURCE.indexOf("export async function uploadDailySpecialImageAction")
  );
  assert.match(uploadBlock, /if \(!count\) \{/);
  // Two cleanup call sites for the NEW object: updateError branch and !count branch.
  const cleanupCount = (uploadBlock.match(/storage\.from\(BUCKET\)\.remove\(\[path\]\)/g) ?? []).length;
  assert.equal(cleanupCount, 2);
});

// ─────────────────────────────────────────────────────────────────────────
// Replacement cleanup of the PREVIOUS image (added after Phase 2 review —
// replacement previously left the object it replaced orphaned forever)
// ─────────────────────────────────────────────────────────────────────────

function extractUploadBlock(): string {
  return IMAGE_ACTIONS_SOURCE.slice(
    IMAGE_ACTIONS_SOURCE.indexOf("export async function uploadDailySpecialImageAction"),
    IMAGE_ACTIONS_SOURCE.indexOf("export async function removeDailySpecialImageAction")
  );
}

test("replacement reads the previous image_url fresh from the database, scoped by id + venue_id, before uploading", () => {
  const uploadBlock = extractUploadBlock();
  assert.match(
    uploadBlock,
    /\.select\("image_url"\)\s*\n\s*\.eq\("id", specialId\)\s*\n\s*\.eq\("venue_id", targetVenueId\)/
  );
  const readIdx = uploadBlock.indexOf('.select("image_url")');
  const uploadCallIdx = uploadBlock.indexOf(".storage\n    .from(BUCKET)\n    .upload(");
  assert.ok(readIdx > -1);
  assert.ok(uploadCallIdx > -1);
  assert.ok(readIdx < uploadCallIdx, "previous image_url must be read before the new upload happens");
});

test("successful replacement attempts to clean up the PREVIOUS object (guarded by parseOwnedStoragePath)", () => {
  const uploadBlock = extractUploadBlock();
  assert.match(uploadBlock, /previousImageUrl/);
  assert.match(uploadBlock, /parseOwnedStoragePath\(previousImageUrl, BUCKET\)/);
  assert.match(uploadBlock, /storage\.from\(BUCKET\)\.remove\(\[previousPath\]\)/);
});

test("old-object cleanup happens ONLY after the DB update is confirmed successful — after both the updateError check and the !count check", () => {
  const uploadBlock = extractUploadBlock();
  const updateErrorCheckIdx = uploadBlock.indexOf("if (updateError) {");
  const countCheckIdx = uploadBlock.indexOf("if (!count) {");
  const previousCleanupIdx = uploadBlock.indexOf("if (previousImageUrl) {");
  assert.ok(updateErrorCheckIdx > -1 && countCheckIdx > -1 && previousCleanupIdx > -1);
  assert.ok(previousCleanupIdx > updateErrorCheckIdx);
  assert.ok(previousCleanupIdx > countCheckIdx);
});

test("DB update failure (updateError or zero rows) never removes the previous object — only the two `[path]` (new-object) cleanup calls exist in those branches, never `[previousPath]`", () => {
  const uploadBlock = extractUploadBlock();
  const previousCleanupIdx = uploadBlock.indexOf("if (previousImageUrl) {");
  const beforeCleanup = uploadBlock.slice(0, previousCleanupIdx);
  // Everything before the previous-image cleanup block (i.e. both failure
  // branches) must reference only `[path]`, never `[previousPath]`.
  assert.doesNotMatch(beforeCleanup, /remove\(\[previousPath\]\)/);
});

test("previous-object cleanup failure is non-fatal — uses the same .catch(() => {}) pattern as every other best-effort storage delete here", () => {
  const uploadBlock = extractUploadBlock();
  assert.match(uploadBlock, /remove\(\[previousPath\]\)\.catch\(\(\) => \{\}\)/);
});

test("previous-object cleanup is skipped entirely when there was no previous image (previousImageUrl is falsy)", () => {
  const uploadBlock = extractUploadBlock();
  assert.match(uploadBlock, /if \(previousImageUrl\) \{/);
});

test("external/non-owned previous URLs are never blindly deleted — cleanup is routed through parseOwnedStoragePath(), not a raw path/URL removal", () => {
  const uploadBlock = extractUploadBlock();
  // The only remove() call using a previous-image-derived value is guarded
  // by `if (previousPath)`, and previousPath comes exclusively from
  // parseOwnedStoragePath() (see storagePath.test.ts for that function's
  // own direct unit tests proving it rejects external/non-owned URLs).
  assert.match(uploadBlock, /const previousPath = parseOwnedStoragePath\(previousImageUrl, BUCKET\);\s*\n\s*if \(previousPath\) \{/);
});

test("remove is best-effort on the storage delete but authoritative on the DB update (clears image_url regardless of storage cleanup outcome)", () => {
  const removeBlock = IMAGE_ACTIONS_SOURCE.slice(
    IMAGE_ACTIONS_SOURCE.indexOf("export async function removeDailySpecialImageAction")
  );
  assert.match(removeBlock, /image_url: null/);
  assert.match(removeBlock, /non-fatal/i);
  // The DB update (authoritative) happens before the storage delete
  // (best-effort) — clearing image_url must never wait on, or be undone
  // by, the storage side.
  const dbUpdateIdx = removeBlock.indexOf("image_url: null");
  const storageRemoveIdx = removeBlock.indexOf("storage.from(BUCKET).remove(");
  assert.ok(dbUpdateIdx > -1 && storageRemoveIdx > -1 && dbUpdateIdx < storageRemoveIdx);
});

test("both image actions are scoped by id AND venue_id on every DB write", () => {
  const uploadBlock = IMAGE_ACTIONS_SOURCE.slice(
    IMAGE_ACTIONS_SOURCE.indexOf("export async function uploadDailySpecialImageAction"),
    IMAGE_ACTIONS_SOURCE.indexOf("export async function removeDailySpecialImageAction")
  );
  const removeBlock = IMAGE_ACTIONS_SOURCE.slice(
    IMAGE_ACTIONS_SOURCE.indexOf("export async function removeDailySpecialImageAction")
  );
  for (const block of [uploadBlock, removeBlock]) {
    assert.match(block, /\.eq\("id", specialId\)/);
    assert.match(block, /\.eq\("venue_id", targetVenueId\)/);
  }
});
