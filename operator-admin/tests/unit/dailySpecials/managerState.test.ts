import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAfterSave } from "../../../src/app/admin/daily-specials/DailySpecialsManager";

/**
 * Phase 2 correction — post-create UX fix: creating a new Daily Special
 * used to leave the operator inside an open "Edit Daily Special" form on
 * the just-created row, which read as unfinished/ambiguous. Editing an
 * existing Special was already correct (stays selected, form stays open),
 * as is delete (already cleared selection on success before this task).
 *
 * resolveAfterSave() is the real function DailySpecialsManager's
 * handleSaved() calls — not a reimplementation. Importable directly from a
 * plain Node test despite the file being "use client": that RSC boundary
 * transform only applies inside Next.js's own build pipeline, never to a
 * direct Node/tsx import of the module (see this repo's other pure-logic
 * extractions, e.g. src/lib/dailySpecialAuthorization.ts, for the same
 * reasoning already established).
 */

test("post-save: successful CREATE clears the selection and exits to the neutral idle state", () => {
  const result = resolveAfterSave(true, "special-123");
  assert.equal(result.selectedId, null);
  assert.equal(result.mode, "idle");
});

test("post-save: successful EDIT keeps the saved Special selected with the form open", () => {
  const result = resolveAfterSave(false, "special-123");
  assert.equal(result.selectedId, "special-123");
  assert.equal(result.mode, "editing");
});

test("post-save: the returned selectedId for an EDIT is exactly the saved special's id, not a stale prior selection", () => {
  const result = resolveAfterSave(false, "brand-new-id-xyz");
  assert.equal(result.selectedId, "brand-new-id-xyz");
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE — clears selection and returns to idle (source-regression: no
// pure function to extract here, deleteDailySpecialAction is itself a real
// server-action call with no meaningful decision logic beyond "always
// clear on success", already covered as a source fact).
// ─────────────────────────────────────────────────────────────────────────

const MANAGER_PATH = join(
  __dirname,
  "../../../src/app/admin/daily-specials/DailySpecialsManager.tsx"
);
const MANAGER_SOURCE = readFileSync(MANAGER_PATH, "utf8");

test("delete: clears selectedId and returns to idle mode on success", () => {
  const deleteBlock = MANAGER_SOURCE.slice(MANAGER_SOURCE.indexOf("const handleDelete = async"));
  const successBlock = deleteBlock.slice(
    deleteBlock.indexOf("await deleteDailySpecialAction("),
    deleteBlock.indexOf("} catch")
  );
  assert.match(successBlock, /setSelectedId\(null\)/);
  assert.match(successBlock, /setMode\("idle"\)/);
});

test("handleSaved calls resolveAfterSave() rather than duplicating the create/edit branching inline", () => {
  assert.match(MANAGER_SOURCE, /const next = resolveAfterSave\(wasCreating, savedSpecialId\);/);
  assert.match(MANAGER_SOURCE, /setSelectedId\(next\.selectedId\);/);
  assert.match(MANAGER_SOURCE, /setMode\(next\.mode\);/);
});

test("success toast only fires for CREATE, not EDIT", () => {
  const handleSavedBlock = MANAGER_SOURCE.slice(
    MANAGER_SOURCE.indexOf("const handleSaved = async"),
    MANAGER_SOURCE.indexOf("const handleCancelCreate")
  );
  assert.match(handleSavedBlock, /if \(wasCreating\) showSuccessToast\("Daily Special created\."\);/);
});
