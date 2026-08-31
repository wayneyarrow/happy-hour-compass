import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 1B — structural regression coverage for the Founder Control Panel's
 * manual onboarding-completion override actions
 * (src/app/control-panel/venues/[id]/actions.ts). Same no-DI-seam,
 * static-source-text convention as cancelVenueActionRegression.test.ts and
 * googleIdentityPanel.test.ts — these Server Actions call
 * createClient()/createAdminClient()/logAuditEvent() directly.
 *
 * Covers tests #14-17 from the Phase 1B task: internal venue-note creation,
 * audit-event emission, and the Founder/Admin-only auth gate.
 */

const SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/venues/[id]/actions.ts"),
  "utf8"
);

function fnBody(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `expected to find export async function ${name}(`);
  // Slice to the next top-level "export async function" (or EOF).
  const rest = SOURCE.slice(start);
  const nextExportIdx = rest.indexOf("\nexport async function ", 1);
  return nextExportIdx === -1 ? rest : rest.slice(0, nextExportIdx);
}

// ── 17. Non-Founder/unauthorized users cannot perform the override ──────────

test("markOnboardingCompleteAction gates on getAdmin() (isControlPanelAdmin) before any write", () => {
  const fn = fnBody("markOnboardingCompleteAction");
  assert.match(fn, /const admin = await getAdmin\(\);/);
  assert.match(fn, /if \(!admin\) return \{ success: false, error: "Session expired\." \};/);
  // The admin check must precede the venues update.
  const adminIdx = fn.indexOf("const admin = await getAdmin();");
  const updateIdx = fn.indexOf('.from("venues")\n    .update({');
  assert.ok(adminIdx > -1 && updateIdx > -1 && adminIdx < updateIdx);
});

test("clearOnboardingOverrideAction gates on getAdmin() before any write", () => {
  const fn = fnBody("clearOnboardingOverrideAction");
  assert.match(fn, /const admin = await getAdmin\(\);/);
  assert.match(fn, /if \(!admin\) return \{ success: false, error: "Session expired\." \};/);
  const adminIdx = fn.indexOf("const admin = await getAdmin();");
  const updateIdx = fn.indexOf('.from("venues")\n    .update({');
  assert.ok(adminIdx > -1 && updateIdx > -1 && adminIdx < updateIdx);
});

// ── Reason requirement (mark = required, clear = optional) ──────────────────

test("markOnboardingCompleteAction requires a non-empty reason and returns early without writing if missing", () => {
  const fn = fnBody("markOnboardingCompleteAction");
  assert.match(fn, /if \(!reason\) \{\s*\n\s*return \{ success: false, error: "A reason is required/);
  const guardIdx = fn.indexOf("if (!reason)");
  const updateIdx = fn.indexOf('.from("venues")\n    .update({');
  assert.ok(guardIdx > -1 && updateIdx > -1 && guardIdx < updateIdx);
});

test("clearOnboardingOverrideAction's reason is optional (no required-field guard)", () => {
  const fn = fnBody("clearOnboardingOverrideAction");
  assert.match(fn, /const clearReason = \(formData\.get\("reason"\) as string \| null\)\?\.trim\(\) \|\| null;/);
  assert.doesNotMatch(fn, /if \(!clearReason\)/);
});

// ── 14 & 15. Internal venue notes created automatically ──────────────────────

test("marking onboarding complete automatically inserts a venue_notes entry attributing the founder/admin and reason", () => {
  const fn = fnBody("markOnboardingCompleteAction");
  assert.match(fn, /await supabase\.from\("venue_notes"\)\.insert\(\{/);
  assert.match(fn, /Onboarding manually marked complete by Founder\/Admin\. Reason: \$\{reason\}/);
  assert.match(fn, /created_by:\s*admin\.id,/);
  assert.match(fn, /created_by_email:\s*admin\.email,/);
});

test("clearing the override automatically inserts a venue_notes entry recording the reversal", () => {
  const fn = fnBody("clearOnboardingOverrideAction");
  assert.match(fn, /await supabase\.from\("venue_notes"\)\.insert\(\{/);
  assert.match(fn, /Manual onboarding completion cleared by Founder\/Admin\. Venue returned to automatic onboarding status\./);
  assert.match(fn, /\(clearReason \? ` Reason: \$\{clearReason\}` : ""\)/);
});

// ── 16. Audit events on both actions ─────────────────────────────────────────

test("marking onboarding complete logs an audit event", () => {
  const fn = fnBody("markOnboardingCompleteAction");
  assert.match(fn, /await logAuditEvent\(\{/);
  assert.match(fn, /action:\s*"venue_onboarding_manually_completed",/);
  assert.match(fn, /entityType:\s*"venue",/);
});

test("clearing the override logs an audit event", () => {
  const fn = fnBody("clearOnboardingOverrideAction");
  assert.match(fn, /await logAuditEvent\(\{/);
  assert.match(fn, /action:\s*"venue_onboarding_override_cleared",/);
  assert.match(fn, /entityType:\s*"venue",/);
});

// ── Ordering: update → note → audit (matches every other founder mutation) ──

test("markOnboardingCompleteAction writes in order: venues update, then venue_notes insert, then audit log", () => {
  const fn = fnBody("markOnboardingCompleteAction");
  const updateIdx = fn.indexOf('.from("venues")\n    .update({');
  const noteIdx   = fn.indexOf('await supabase.from("venue_notes").insert({');
  const auditIdx  = fn.indexOf("await logAuditEvent({");
  assert.ok(updateIdx > -1 && noteIdx > -1 && auditIdx > -1);
  assert.ok(updateIdx < noteIdx && noteIdx < auditIdx);
});

test("clearOnboardingOverrideAction writes in order: venues update, then venue_notes insert, then audit log", () => {
  const fn = fnBody("clearOnboardingOverrideAction");
  const updateIdx = fn.indexOf('.from("venues")\n    .update({');
  const noteIdx   = fn.indexOf('await supabase.from("venue_notes").insert({');
  const auditIdx  = fn.indexOf("await logAuditEvent({");
  assert.ok(updateIdx > -1 && noteIdx > -1 && auditIdx > -1);
  assert.ok(updateIdx < noteIdx && noteIdx < auditIdx);
});

// ── Reversibility: clear is a no-op guard when no override is active ─────────

test("clearOnboardingOverrideAction refuses to clear when no override is currently active", () => {
  const fn = fnBody("clearOnboardingOverrideAction");
  assert.match(fn, /if \(!v\.onboarding_completed_override_at\) \{\s*\n\s*return \{ success: false, error: "This venue does not have a manual onboarding override\." \};/);
});

// ── Publication independence ──────────────────────────────────────────────────

test("neither action ever writes is_published — onboarding override is independent of publication status", () => {
  for (const name of ["markOnboardingCompleteAction", "clearOnboardingOverrideAction"]) {
    const fn = fnBody(name);
    assert.doesNotMatch(fn, /is_published/);
  }
});
